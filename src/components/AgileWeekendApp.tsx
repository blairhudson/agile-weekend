import { forwardRef, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from "react";
import { toPng } from "html-to-image";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

const STORAGE_KEY = "agile-weekend-state";
const LEGACY_STORAGE_KEY = "agile-weekend-project";
const CTA = "Make your own at blairhudson.com/agile-weekend";
const REPORT_WIDTH = 1080;

const statuses = ["todo", "doing", "done", "blocked"] as const;
const themes = ["linearDark", "mondayPop", "editorial", "neonSprint"] as const;

type Status = (typeof statuses)[number];
type ThemeId = (typeof themes)[number];

type Task = {
  id: string;
  title: string;
  status: Status;
  link: string;
  note: string;
};

type Project = {
  goal: string;
  weekendStart: string;
  theme: ThemeId;
  tasks: Task[];
};

type StoredState = {
  currentWeekend: string;
  projects: Record<string, Project>;
};

const statusLabels: Record<Status, string> = {
  todo: "Todo",
  doing: "Doing",
  done: "Done",
  blocked: "Blocked",
};

const themeLabels: Record<ThemeId, string> = {
  linearDark: "Linear Dark",
  mondayPop: "Monday Pop",
  editorial: "Editorial",
  neonSprint: "Neon Sprint",
};

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toDateInputValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseLocalDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function normalizeWeekendStart(value: string) {
  return getWeekendStart(parseLocalDate(value));
}

function getWeekendStart(date = new Date()) {
  const saturday = new Date(date);
  const day = saturday.getDay();
  const daysSinceSaturday = (day + 1) % 7;
  saturday.setDate(saturday.getDate() - daysSinceSaturday);
  saturday.setHours(0, 0, 0, 0);
  return toDateInputValue(saturday);
}

function addDays(value: string, days: number) {
  const date = parseLocalDate(value);
  date.setDate(date.getDate() + days);
  return toDateInputValue(date);
}

function formatWeekend(value: string) {
  const start = parseLocalDate(value);
  const end = new Date(start);
  end.setDate(start.getDate() + 1);
  const formatter = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" });
  return `${formatter.format(start)}-${formatter.format(end)}`;
}

function formatWeekendIcon(value: string) {
  const start = parseLocalDate(value);
  const end = new Date(start);
  end.setDate(start.getDate() + 1);
  const monthFormatter = new Intl.DateTimeFormat("en", { month: "short" });
  const dayFormatter = new Intl.DateTimeFormat("en", { day: "numeric" });
  return {
    startMonth: monthFormatter.format(start),
    startDay: dayFormatter.format(start),
    endMonth: monthFormatter.format(end),
    endDay: dayFormatter.format(end),
  };
}

function formatLastSaved(value: number | null, now = Date.now()) {
  if (!value) return "Browser not saved yet";
  const seconds = Math.max(0, Math.floor((now - value) / 1000));
  if (seconds < 10) return "Browser last saved just now";
  if (seconds < 60) return `Browser last saved ${seconds} secs ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `Browser last saved ${minutes} min${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  return `Browser last saved ${hours} hr${hours === 1 ? "" : "s"} ago`;
}

function isStatus(value: string): value is Status {
  return statuses.includes(value as Status);
}

function isTheme(value: string): value is ThemeId {
  return themes.includes(value as ThemeId);
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function emptyProject(weekendStart = getWeekendStart(), theme: ThemeId = "linearDark"): Project {
  return {
    goal: "",
    weekendStart,
    theme,
    tasks: [],
  };
}

function sampleProject(): Project {
  const weekendStart = getWeekendStart();
  return {
    goal: "Learn Astro, ship something tiny, and share proof of progress.",
    weekendStart,
    theme: "linearDark",
    tasks: [
      {
        id: "task-1",
        title: "Astro basics",
        status: "done",
        link: "https://docs.astro.build/",
        note: "Built a static page and understood islands.",
      },
      {
        id: "task-2",
        title: "GitHub Pages deploy",
        status: "doing",
        link: "https://docs.github.com/en/pages",
        note: "Got build path clear; testing final workflow.",
      },
      {
        id: "task-3",
        title: "Write short reflection",
        status: "todo",
        link: "",
        note: "Summarize what I learned in three bullets.",
      },
    ],
  };
}

function normalizeProject(input: unknown, fallback = emptyProject(), weekendStart = fallback.weekendStart): Project {
  const value = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const rawTasks = Array.isArray(value.tasks) ? value.tasks : fallback.tasks;
  const normalizedWeekendStart = normalizeWeekendStart(asString(value.weekendStart, weekendStart));

  return {
    goal: asString(value.goal, asString(value.title, fallback.goal)),
    weekendStart: normalizedWeekendStart,
    theme: isTheme(asString(value.theme)) ? (value.theme as ThemeId) : fallback.theme,
    tasks: rawTasks.map((item, index) => {
      const task = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const status = asString(task.status);

      return {
        id: asString(task.id, `task-${index + 1}-${newId()}`),
        title: asString(task.title, `Weekend task ${index + 1}`),
        status: isStatus(status) ? status : "todo",
        link: asString(task.link),
        note: asString(task.note),
      };
    }),
  };
}

function initialState(): StoredState {
  const project = sampleProject();
  return {
    currentWeekend: project.weekendStart,
    projects: { [project.weekendStart]: project },
  };
}

function normalizeStoredState(input: unknown): StoredState {
  const value = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const rawProjects = value.projects && typeof value.projects === "object" ? (value.projects as Record<string, unknown>) : null;

  if (!rawProjects) {
    const migrated = normalizeProject(input, sampleProject(), normalizeWeekendStart(asString(value.weekendStart, getWeekendStart())));
    return { currentWeekend: migrated.weekendStart, projects: { [migrated.weekendStart]: migrated } };
  }

  const currentWeekend = normalizeWeekendStart(asString(value.currentWeekend, getWeekendStart()));
  const projects = Object.fromEntries(
    Object.entries(rawProjects).map(([weekendStart, rawProject]) => {
      const normalizedWeekendStart = normalizeWeekendStart(weekendStart);
      return [
        normalizedWeekendStart,
        normalizeProject(rawProject, emptyProject(normalizedWeekendStart), normalizedWeekendStart),
      ];
    }),
  );

  return {
    currentWeekend,
    projects: {
      ...projects,
      [currentWeekend]: projects[currentWeekend] ?? emptyProject(currentWeekend),
    },
  };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "agile-weekend";
}

function projectToToml(project: Project) {
  return stringifyToml({
    goal: project.goal,
    weekendStart: project.weekendStart,
    theme: project.theme,
    tasks: project.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      link: task.link,
      note: task.note,
    })),
  });
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "application/toml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadUrl(filename: string, url: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
}

function getLinkDisplay(value: string) {
  const normalized = value.trim();
  if (!normalized) return null;

  try {
    const url = new URL(normalized.match(/^https?:\/\//) ? normalized : `https://${normalized}`);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    const [owner, rawRepo, resourceType, resourceNumber] = url.pathname.split("/").filter(Boolean);

    if (host === "github.com" && owner && rawRepo) {
      const repo = rawRepo.replace(/\.git$/, "");
      return {
        type: "github" as const,
        label: `${owner}/${repo}`,
        meta: resourceType === "pull" && resourceNumber ? `PR #${resourceNumber}` : undefined,
      };
    }

    return { type: "link" as const, label: `${host}${url.pathname === "/" ? "" : url.pathname}`.replace(/\/$/, "") };
  } catch {
    return { type: "link" as const, label: normalized.replace(/^https?:\/\//, "").replace(/\/$/, "") };
  }
}

function taskSignature(task: Task) {
  return [task.title, task.link, task.note]
    .map((value) => value.trim().toLowerCase())
    .join("|");
}

export default function AgileWeekendApp() {
  const [state, setState] = useState<StoredState>(() => initialState());
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [exporting, setExporting] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [previewScale, setPreviewScale] = useState(0.38);
  const [previewWidth, setPreviewWidth] = useState(48);
  const [reportHeight, setReportHeight] = useState(900);
  const reportRef = useRef<HTMLDivElement>(null);
  const previewFrameRef = useRef<HTMLDivElement>(null);
  const project = state.projects[state.currentWeekend] ?? emptyProject(state.currentWeekend);
  const doneCount = project.tasks.filter((task) => task.status === "done").length;
  const totalCount = project.tasks.length;
  const completion = totalCount ? Math.round((doneCount / totalCount) * 100) : 0;
  const linkSuggestions = Array.from(new Set(
    Object.values(state.projects)
      .flatMap((savedProject) => savedProject.tasks.map((task) => task.link.trim()))
      .filter(Boolean),
  )).slice(0, 12);

  useEffect(() => {
    document.documentElement.dataset.theme = project.theme;
  }, [project.theme]);

  useEffect(() => {
    const raw = window.localStorage.getItem(STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw) {
      try {
        setState(normalizeStoredState(JSON.parse(raw)));
      } catch {
        setMessage("Saved browser data was invalid. Loaded sample project.");
      }
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    setLastSavedAt(Date.now());
  }, [loaded, state]);

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    const canvas = reportRef.current;
    if (!canvas) return;

    const updateReportHeight = () => setReportHeight(Math.ceil(canvas.scrollHeight));
    updateReportHeight();
    const observer = new ResizeObserver(updateReportHeight);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [project]);

  useEffect(() => {
    const frame = previewFrameRef.current;
    if (!frame) return;

    const updateScale = () => {
      const { width, height } = frame.getBoundingClientRect();
      setPreviewScale(Math.max(0.2, Math.min(width / REPORT_WIDTH, height / reportHeight, 1)));
    };

    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [reportHeight]);

  function updateProject(updater: (project: Project) => Project) {
    setState((current) => {
      const currentProject = current.projects[current.currentWeekend] ?? emptyProject(current.currentWeekend);
      const nextProject = updater(currentProject);
      return {
        ...current,
        currentWeekend: nextProject.weekendStart,
        projects: { ...current.projects, [nextProject.weekendStart]: nextProject },
      };
    });
  }

  function shiftWeekend(days: -7 | 7) {
    setState((current) => {
      const currentProject = current.projects[current.currentWeekend] ?? emptyProject(current.currentWeekend);
      const weekendStart = normalizeWeekendStart(addDays(current.currentWeekend, days));
      const nextProject = current.projects[weekendStart] ?? emptyProject(weekendStart, currentProject.theme);
      return {
        currentWeekend: weekendStart,
        projects: {
          ...current.projects,
          [current.currentWeekend]: currentProject,
          [weekendStart]: nextProject,
        },
      };
    });
    setMessage("");
  }

  function selectWeekend(weekendStart: string) {
    const normalizedWeekendStart = normalizeWeekendStart(weekendStart);
    setState((current) => {
      const currentProject = current.projects[current.currentWeekend] ?? emptyProject(current.currentWeekend);
      const nextProject = current.projects[normalizedWeekendStart] ?? emptyProject(normalizedWeekendStart, currentProject.theme);
      return {
        currentWeekend: normalizedWeekendStart,
        projects: {
          ...current.projects,
          [current.currentWeekend]: currentProject,
          [normalizedWeekendStart]: nextProject,
        },
      };
    });
    setMessage("");
  }

  function saveToml() {
    downloadText(`${project.weekendStart}-${slugify(project.goal)}.toml`, projectToToml(project));
    setMessage("Saved TOML.");
  }

  function loadToml(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const nextProject = normalizeProject(parseToml(String(reader.result)), emptyProject(state.currentWeekend, project.theme), state.currentWeekend);
        updateProject(() => nextProject);
        setMessage("Loaded TOML into this weekend.");
      } catch (error) {
        setMessage(error instanceof Error ? `Invalid TOML: ${error.message}` : "Invalid TOML.");
      }
    };
    reader.readAsText(file);
  }

  async function exportPng() {
    if (!reportRef.current) return;
    setExporting(true);
    try {
      downloadUrl(`${project.weekendStart}-${slugify(project.goal)}-linkedin.png`, await renderPngUrl());
      setMessage("Exported PNG.");
    } catch (error) {
      setMessage(error instanceof Error ? `Export failed: ${error.message}` : "Export failed.");
    } finally {
      setExporting(false);
    }
  }

  async function renderPngUrl() {
    if (!reportRef.current) throw new Error("Preview not ready");
    const exportHeight = Math.ceil(reportRef.current.scrollHeight || reportHeight);
    return toPng(reportRef.current, {
      cacheBust: true,
      pixelRatio: 1,
      width: REPORT_WIDTH,
      height: exportHeight,
      style: { transform: "none", width: `${REPORT_WIDTH}px`, height: `${exportHeight}px` },
    });
  }

  function resetWeekend() {
    updateProject((current) => emptyProject(current.weekendStart, current.theme));
    setMessage("Reset this weekend.");
  }

  function addTask() {
    updateProject((current) => ({
      ...current,
      tasks: [...current.tasks, { id: newId(), title: "", status: "todo", link: "", note: "" }],
    }));
  }

  function getBringForwardTasks() {
    const previousWeekend = addDays(project.weekendStart, -7);
    const previousProject = state.projects[previousWeekend];
    if (!previousProject) return [];

    const existingTasks = new Set(project.tasks.map(taskSignature));
    return previousProject.tasks.filter((task) => {
      const hasContent = task.title.trim() || task.link.trim() || task.note.trim();
      return task.status !== "done" && hasContent && !existingTasks.has(taskSignature(task));
    });
  }

  function bringForwardIncompleteTasks() {
    const tasksToBring = getBringForwardTasks();
    if (!tasksToBring.length) {
      setMessage("No incomplete tasks to bring forward.");
      return;
    }

    updateProject((current) => ({
      ...current,
      tasks: [...current.tasks, ...tasksToBring.map((task) => ({ ...task, id: newId() }))],
    }));
    setMessage(`Brought forward ${tasksToBring.length} task${tasksToBring.length === 1 ? "" : "s"}.`);
  }

  function startPreviewResize(event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = previewWidth;

    function resize(moveEvent: PointerEvent) {
      const deltaVw = ((startX - moveEvent.clientX) / window.innerWidth) * 100;
      setPreviewWidth(Math.min(68, Math.max(32, startWidth + deltaVw)));
    }

    function stopResize() {
      document.removeEventListener("pointermove", resize);
    }

    document.addEventListener("pointermove", resize);
    document.addEventListener("pointerup", stopResize, { once: true });
  }

  return (
    <main className="app-shell">
      <AppHeader
        project={project}
        exporting={exporting}
        onShiftWeekend={shiftWeekend}
        onThemeChange={(theme) => updateProject((current) => ({ ...current, theme }))}
        onSave={saveToml}
        onLoad={loadToml}
        onExport={exportPng}
        onReset={resetWeekend}
        onAddTask={addTask}
      />

      {message && (
        <div className="toast" aria-live="polite">
          <span>{message}</span>
          <button type="button" aria-label="Dismiss notification" onClick={() => setMessage("")}>×</button>
        </div>
      )}

      <div className="app-grid" style={{ "--preview-width": `${previewWidth}vw` } as CSSProperties}>
        <EditorPanel
          project={project}
          onSelectWeekend={selectWeekend}
          onGoalChange={(goal) => updateProject((current) => ({ ...current, goal }))}
          onAddTask={addTask}
          onBringForwardTasks={bringForwardIncompleteTasks}
          bringForwardCount={getBringForwardTasks().length}
          linkSuggestions={linkSuggestions}
          onUpdateTask={(id, patch) => updateProject((current) => ({
            ...current,
            tasks: current.tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)),
          }))}
          onDeleteTask={(id) => updateProject((current) => ({
            ...current,
            tasks: current.tasks.filter((task) => task.id !== id),
          }))}
          onMoveTask={(id, direction) => updateProject((current) => {
            const index = current.tasks.findIndex((task) => task.id === id);
            const target = index + direction;
            if (index < 0 || target < 0 || target >= current.tasks.length) return current;
            const tasks = [...current.tasks];
            [tasks[index], tasks[target]] = [tasks[target], tasks[index]];
            return { ...current, tasks };
          })}
        />

        <div className="splitter" role="separator" aria-label="Resize preview panel" aria-orientation="vertical" onPointerDown={startPreviewResize} />

        <PreviewPanel previewFrameRef={previewFrameRef} exporting={exporting} onExport={exportPng}>
          <ReportPreview
            ref={reportRef}
            project={project}
            reportHeight={reportHeight}
            scale={previewScale}
          />
        </PreviewPanel>
      </div>

      <footer className="status-bar">
        <span>{formatWeekend(project.weekendStart)}</span>
        <span>{completion}% complete</span>
        <span>{doneCount}/{totalCount} done</span>
        <span>{formatLastSaved(lastSavedAt, now)}</span>
      </footer>
    </main>
  );
}

type AppHeaderProps = {
  project: Project;
  exporting: boolean;
  onShiftWeekend: (days: -7 | 7) => void;
  onThemeChange: (theme: ThemeId) => void;
  onSave: () => void;
  onLoad: (file: File | undefined) => void;
  onExport: () => void;
  onReset: () => void;
  onAddTask: () => void;
};

function AppHeader({ project, exporting, onShiftWeekend, onThemeChange, onSave, onLoad, onExport, onReset, onAddTask }: AppHeaderProps) {
  const [openMenu, setOpenMenu] = useState<"file" | "edit" | "view" | null>(null);
  const menuBarRef = useRef<HTMLElement>(null);
  const loadInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!openMenu) return;

    function closeOnOutsideClick(event: PointerEvent) {
      if (!menuBarRef.current?.contains(event.target as Node)) setOpenMenu(null);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpenMenu(null);
    }

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [openMenu]);

  useEffect(() => {
    function runShortcut(event: KeyboardEvent) {
      if (event.repeat) return;
      const key = event.key.toLowerCase();
      const mod = event.metaKey || event.ctrlKey;
      const isLeft = event.key === "ArrowLeft" || event.code === "BracketLeft";
      const isRight = event.key === "ArrowRight" || event.code === "BracketRight";

      if (event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
        if (key === "f") {
          event.preventDefault();
          setOpenMenu((current) => (current === "file" ? null : "file"));
          return;
        }
        if (key === "e") {
          event.preventDefault();
          setOpenMenu((current) => (current === "edit" ? null : "edit"));
          return;
        }
        if (key === "t") {
          event.preventDefault();
          setOpenMenu((current) => (current === "view" ? null : "view"));
          return;
        }
        if (event.key === "[") {
          event.preventDefault();
          onShiftWeekend(-7);
          setOpenMenu(null);
          return;
        }
        if (event.key === "]") {
          event.preventDefault();
          onShiftWeekend(7);
          setOpenMenu(null);
          return;
        }
        const theme = themes[Number(event.key) - 1];
        if (theme) {
          event.preventDefault();
          onThemeChange(theme);
          setOpenMenu(null);
        }
        return;
      }

      if (mod && event.altKey && isLeft && !event.shiftKey) {
        event.preventDefault();
        onShiftWeekend(-7);
        setOpenMenu(null);
        return;
      }
      if (mod && event.altKey && isRight && !event.shiftKey) {
        event.preventDefault();
        onShiftWeekend(7);
        setOpenMenu(null);
        return;
      }

      if (!mod || event.altKey) return;
      if (key === "s" && !event.shiftKey) {
        event.preventDefault();
        onSave();
        setOpenMenu(null);
        return;
      }
      if (key === "o" && !event.shiftKey) {
        event.preventDefault();
        loadInputRef.current?.click();
        setOpenMenu(null);
        return;
      }
      if (key === "e" && !event.shiftKey) {
        event.preventDefault();
        onExport();
        setOpenMenu(null);
        return;
      }
      if ((key === "n" || event.key === "Enter") && !event.shiftKey) {
        event.preventDefault();
        onAddTask();
        setOpenMenu(null);
        return;
      }
      if (event.shiftKey && event.key === "Backspace") {
        event.preventDefault();
        onReset();
        setOpenMenu(null);
      }
    }

    document.addEventListener("keydown", runShortcut, { capture: true });
    return () => document.removeEventListener("keydown", runShortcut, { capture: true });
  }, [onAddTask, onExport, onLoad, onReset, onSave, onShiftWeekend, onThemeChange]);

  function runMenuAction(action: () => void) {
    action();
    setOpenMenu(null);
  }

  function loadSelectedFile(file: File | undefined, input: HTMLInputElement) {
    onLoad(file);
    input.value = "";
    setOpenMenu(null);
  }

  return (
    <header className="app-header">
      <div className="brand-lockup">
        <span>Agile Weekend</span>
      </div>

      <nav className="menu-bar" aria-label="Application menu" ref={menuBarRef}>
        <div className={`menu ${openMenu === "file" ? "is-open" : ""}`}>
          <button type="button" className="menu-trigger" title="Alt+F" onClick={() => setOpenMenu(openMenu === "file" ? null : "file")}>File</button>
          {openMenu === "file" && <div className="menu-popover">
            <button type="button" onClick={() => runMenuAction(onSave)}><span>Save TOML</span><kbd>⌘S</kbd></button>
            <label className="menu-file-item">
              <span>Load TOML</span><kbd>⌘O</kbd>
              <input ref={loadInputRef} type="file" accept=".toml,application/toml,text/plain" onChange={(event) => loadSelectedFile(event.target.files?.[0], event.currentTarget)} />
            </label>
            <button type="button" onClick={() => runMenuAction(onExport)} disabled={exporting}><span>{exporting ? "Exporting PNG" : "Export PNG"}</span><kbd>⌘E</kbd></button>
            <span className="menu-separator" />
            <button type="button" onClick={() => runMenuAction(onReset)}><span>Reset this weekend</span><kbd>⌘⇧⌫</kbd></button>
          </div>}
        </div>

        <div className={`menu ${openMenu === "edit" ? "is-open" : ""}`}>
          <button type="button" className="menu-trigger" title="Alt+E" onClick={() => setOpenMenu(openMenu === "edit" ? null : "edit")}>Edit</button>
          {openMenu === "edit" && <div className="menu-popover">
            <button type="button" onClick={() => runMenuAction(onAddTask)}><span>Add Task</span><kbd>⌘↵</kbd></button>
            <button type="button" onClick={() => runMenuAction(() => onShiftWeekend(-7))}><span>Previous Weekend</span><kbd>⌘⌥←</kbd></button>
            <button type="button" onClick={() => runMenuAction(() => onShiftWeekend(7))}><span>Next Weekend</span><kbd>⌘⌥→</kbd></button>
          </div>}
        </div>

        <div className={`menu ${openMenu === "view" ? "is-open" : ""}`}>
          <button type="button" className="menu-trigger" title="Alt+T" onClick={() => setOpenMenu(openMenu === "view" ? null : "view")}>Theme</button>
          {openMenu === "view" && <div className="menu-popover">
            {themes.map((theme) => (
              <button key={theme} type="button" className={project.theme === theme ? "is-selected" : ""} onClick={() => runMenuAction(() => onThemeChange(theme))}>
                <span>{project.theme === theme ? "✓ " : ""}{themeLabels[theme]}</span><kbd>⌥{themes.indexOf(theme) + 1}</kbd>
              </button>
            ))}
          </div>}
        </div>
      </nav>

    </header>
  );
}

type EditorPanelProps = {
  project: Project;
  onSelectWeekend: (weekendStart: string) => void;
  onGoalChange: (goal: string) => void;
  onAddTask: () => void;
  onBringForwardTasks: () => void;
  bringForwardCount: number;
  linkSuggestions: string[];
  onUpdateTask: (id: string, patch: Partial<Task>) => void;
  onDeleteTask: (id: string) => void;
  onMoveTask: (id: string, direction: -1 | 1) => void;
};

function EditorPanel({ project, onSelectWeekend, onGoalChange, onAddTask, onBringForwardTasks, bringForwardCount, linkSuggestions, onUpdateTask, onDeleteTask, onMoveTask }: EditorPanelProps) {
  const currentWeekendStart = getWeekendStart();
  const [stripCenter, setStripCenter] = useState(project.weekendStart);
  const [visibleWeekendCount, setVisibleWeekendCount] = useState(5);
  const weekendIconRowRef = useRef<HTMLDivElement>(null);
  const halfVisibleWeekendCount = Math.floor(visibleWeekendCount / 2);
  const visibleWeekends = Array.from({ length: visibleWeekendCount }, (_, index) => addDays(stripCenter, (index - halfVisibleWeekendCount) * 7));

  useEffect(() => {
    const row = weekendIconRowRef.current;
    if (!row) return;

    const updateVisibleWeekendCount = () => {
      const nextCount = Math.max(3, Math.min(13, Math.floor((row.getBoundingClientRect().width + 4) / 80)));
      setVisibleWeekendCount(nextCount % 2 === 0 ? nextCount - 1 : nextCount);
    };

    updateVisibleWeekendCount();
    const observer = new ResizeObserver(updateVisibleWeekendCount);
    observer.observe(row);
    return () => observer.disconnect();
  }, []);

  function jumpToThisWeekend() {
    setStripCenter(currentWeekendStart);
    onSelectWeekend(currentWeekendStart);
  }

  function chooseWeekend(weekendStart: string) {
    setStripCenter(weekendStart);
    onSelectWeekend(weekendStart);
  }

  return (
      <section className="pane editor-pane" aria-label="Weekend editor">
      <div className="editor-weekend-row">
        <div className="weekend-title-row">
          <span className="section-label">Which weekend?</span>
          <button type="button" className="now-button" onClick={jumpToThisWeekend} disabled={project.weekendStart === currentWeekendStart}>Now</button>
        </div>
        <div className="weekend-switcher" aria-label="Weekend selector">
          <button type="button" onClick={() => setStripCenter((weekendStart) => addDays(weekendStart, -7))} aria-label="Previous weekends">&lt;</button>
          <div className="weekend-icon-row" ref={weekendIconRowRef} style={{ gridTemplateColumns: `repeat(${visibleWeekendCount}, minmax(64px, 1fr))` }}>
            {visibleWeekends.map((weekendStart) => {
              const icon = formatWeekendIcon(weekendStart);
              const isSelected = weekendStart === project.weekendStart;
              const isCurrent = weekendStart === currentWeekendStart;
              return (
                <button
                  key={weekendStart}
                  type="button"
                  className={`weekend-icon ${isSelected ? "is-selected" : ""} ${isCurrent ? "is-current" : ""}`}
                  aria-label={`Select ${formatWeekend(weekendStart)}`}
                  aria-current={isSelected ? "date" : undefined}
                  onClick={() => chooseWeekend(weekendStart)}
                >
                  {isCurrent && <em className="current-dot" aria-hidden="true" />}
                  <span className="weekend-date">
                    <small>{icon.startMonth}</small>
                    <strong>{icon.startDay}</strong>
                  </span>
                  <span className="weekend-date">
                    <small>{icon.endMonth}</small>
                    <strong>{icon.endDay}</strong>
                  </span>
                </button>
              );
            })}
          </div>
          <button type="button" onClick={() => setStripCenter((weekendStart) => addDays(weekendStart, 7))} aria-label="Next weekends">&gt;</button>
        </div>
      </div>

      <section className="app-card goal-card">
        <label>
          Weekend goal
          <input value={project.goal} placeholder="What are you trying to learn or do?" onChange={(event) => onGoalChange(event.target.value)} />
        </label>
      </section>

      <section className="app-card items-card">
        <div className="card-header">
          <span className="section-label">Weekend Tasks</span>
          <button type="button" className="primary" onClick={onAddTask}>Add task</button>
        </div>

        <div className="item-list">
          {project.tasks.map((task, index) => (
            <LearningItemCard
              key={task.id}
              task={task}
              index={index}
              isFirst={index === 0}
              isLast={index === project.tasks.length - 1}
              linkSuggestions={linkSuggestions}
              onUpdate={onUpdateTask}
              onDelete={onDeleteTask}
              onMove={onMoveTask}
            />
          ))}
          {!project.tasks.length && (
            <button type="button" className="empty-state" onClick={bringForwardCount ? onBringForwardTasks : onAddTask}>
              {bringForwardCount ? "Continue from last weekend" : "Add first task"}
            </button>
          )}
        </div>
      </section>
    </section>
  );
}

type LearningItemCardProps = {
  task: Task;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  linkSuggestions: string[];
  onUpdate: (id: string, patch: Partial<Task>) => void;
  onDelete: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
};

function LearningItemCard({ task, index, isFirst, isLast, linkSuggestions, onUpdate, onDelete, onMove }: LearningItemCardProps) {
  const [isLinkMenuOpen, setIsLinkMenuOpen] = useState(false);
  const availableLinks = linkSuggestions.filter((link) => link !== task.link.trim());

  return (
    <article className="learning-row">
      <div className="row-index">{index + 1}</div>
      <div className="row-main">
        <div className="row-top">
          <select aria-label="Status" value={task.status} onChange={(event) => onUpdate(task.id, { status: event.target.value as Status })}>
            {statuses.map((status) => <option key={status} value={status}>{statusLabels[status]}</option>)}
          </select>
          <input value={task.title} placeholder="What did you work on?" onChange={(event) => onUpdate(task.id, { title: event.target.value })} />
        </div>
        <div className="link-field">
          <input
            type="url"
            value={task.link}
            placeholder="Link"
            onBlur={() => window.setTimeout(() => setIsLinkMenuOpen(false), 120)}
            onChange={(event) => onUpdate(task.id, { link: event.target.value })}
            onFocus={() => setIsLinkMenuOpen(true)}
            onClick={() => setIsLinkMenuOpen(true)}
          />
          {isLinkMenuOpen && availableLinks.length > 0 && (
            <div className="link-menu" role="listbox" aria-label="Previous links">
              {availableLinks.map((link) => (
                <button
                  key={link}
                  type="button"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    onUpdate(task.id, { link });
                    setIsLinkMenuOpen(false);
                  }}
                >
                  {link}
                </button>
              ))}
            </div>
          )}
        </div>
        <textarea value={task.note} rows={2} maxLength={180} placeholder="Description" onChange={(event) => onUpdate(task.id, { note: event.target.value })} />
      </div>
      <div className="row-actions">
        <button type="button" onClick={() => onMove(task.id, -1)} disabled={isFirst}>Up</button>
        <button type="button" onClick={() => onMove(task.id, 1)} disabled={isLast}>Down</button>
        <button type="button" className="danger" onClick={() => onDelete(task.id)}>Delete</button>
      </div>
    </article>
  );
}

type PreviewPanelProps = {
  children: ReactNode;
  previewFrameRef: RefObject<HTMLDivElement | null>;
  exporting: boolean;
  onExport: () => void;
};

function PreviewPanel({ children, previewFrameRef, exporting, onExport }: PreviewPanelProps) {
  return (
    <aside className="pane preview-pane" aria-label="Infographic preview">
      <div className="pane-titlebar">
        <span className="section-label">Share My Weekend</span>
        <button type="button" className="primary preview-export" onClick={onExport} disabled={exporting}>
          {exporting ? "Exporting" : "Export PNG"}
        </button>
      </div>
      <div className="preview-stage" ref={previewFrameRef}>{children}</div>
    </aside>
  );
}

function ReportLink({ value }: { value: string }) {
  const display = getLinkDisplay(value);
  if (!display) return null;

  return (
    <p className={`report-link ${display.type === "github" ? "report-link-github" : ""}`}>
      {display.type === "github" && (
        <svg className="github-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path fill="currentColor" d="M8 0C3.58 0 0 3.67 0 8.2c0 3.62 2.29 6.69 5.47 7.78.4.08.55-.18.55-.4 0-.2-.01-.86-.01-1.56-2.01.38-2.53-.5-2.69-.96-.09-.24-.48-.96-.82-1.15-.28-.16-.68-.55-.01-.56.63-.01 1.08.59 1.23.84.72 1.24 1.87.89 2.33.68.07-.53.28-.89.51-1.09-1.78-.21-3.64-.91-3.64-4.04 0-.89.31-1.63.82-2.2-.08-.21-.36-1.04.08-2.17 0 0 .67-.22 2.2.84A7.42 7.42 0 0 1 8 3.94c.68 0 1.36.09 2 .28 1.53-1.06 2.2-.84 2.2-.84.44 1.13.16 1.96.08 2.17.51.57.82 1.3.82 2.2 0 3.14-1.87 3.83-3.65 4.04.29.26.54.75.54 1.51 0 1.09-.01 1.97-.01 2.24 0 .22.15.48.55.4A8.14 8.14 0 0 0 16 8.2C16 3.67 12.42 0 8 0Z" />
        </svg>
      )}
      <span>{display.label}</span>
      {display.meta && <strong>{display.meta}</strong>}
    </p>
  );
}

type ReportPreviewProps = {
  project: Project;
  reportHeight: number;
  scale: number;
};

const ReportPreview = forwardRef<HTMLDivElement, ReportPreviewProps>(function ReportPreview(
  { project, reportHeight, scale },
  ref,
) {
  return (
    <div className="report-shell" style={{ width: REPORT_WIDTH * scale, height: reportHeight * scale }}>
      <div className="report-canvas" ref={ref} style={{ transform: `scale(${scale})` }}>
        <div className="report-background" />
        <header className="report-header">
          <div className="report-topline">
            <p className="report-kicker">Agile Weekend</p>
            <div className="report-weekend">{formatWeekend(project.weekendStart)}</div>
          </div>
          <h2>{project.goal || "Set a weekend goal, track progress, share what you learned."}</h2>
        </header>

        <section className="report-status-grid">
          {statuses.map((status) => (
            <div className={`status-card status-${status}`} key={status}>
              <span>{project.tasks.filter((task) => task.status === status).length}</span>
              <p>{statusLabels[status]}</p>
            </div>
          ))}
        </section>

        <section className="report-learning-list">
          <h3>My Weekend</h3>
          {!project.tasks.length && <p className="report-empty">Taking it easy this weekend.</p>}
          {project.tasks.map((task, index) => (
            <article className={`report-learning-item status-${task.status}`} key={task.id}>
              <div className="report-index">{String(index + 1).padStart(2, "0")}</div>
              <div>
                <div className="report-item-head">
                  <b>{task.title || "Weekend task"}</b>
                  <span>{statusLabels[task.status]}</span>
                </div>
                <ReportLink value={task.link} />
                {task.note && <p>{task.note}</p>}
              </div>
            </article>
          ))}
        </section>

        <footer className="report-footer">{CTA}</footer>
      </div>
    </div>
  );
});
