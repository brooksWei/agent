import { execFileSync, execSync } from "node:child_process";
import path from "node:path";

function normalizePathForMatch(value) {
  return value.replace(/\//g, "\\").toLowerCase();
}

function listNodeProcessesOnWindows() {
  const script = [
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\"",
    "| Select-Object ProcessId,ParentProcessId,CommandLine",
    "| ConvertTo-Json -Compress",
  ].join(" ");

  const output = execFileSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }
  ).trim();

  if (!output) {
    return [];
  }

  const parsed = JSON.parse(output);
  const rows = Array.isArray(parsed) ? parsed : [parsed];
  return rows
    .map((item) => ({
      pid: Number(item.ProcessId),
      commandLine:
        typeof item.CommandLine === "string" ? item.CommandLine : "",
    }))
    .filter((item) => Number.isFinite(item.pid));
}

function shouldSkipProcess(pid, commandLine, excludedPids) {
  if (excludedPids.has(pid)) {
    return true;
  }

  const normalized = commandLine.toLowerCase();
  if (
    normalized.includes("npm-cli") ||
    normalized.includes("npm\\bin\\npm") ||
    normalized.includes("corepack") ||
    normalized.includes("cleanup-project-node.mjs")
  ) {
    return true;
  }

  return false;
}

function killProcessTreeOnWindows(pid) {
  try {
    execSync(`taskkill /PID ${pid} /T /F`, {
      stdio: ["ignore", "ignore", "ignore"],
    });
    return true;
  } catch {
    return false;
  }
}

function cleanupNodeProcessesOnWindows() {
  const projectRoot = normalizePathForMatch(process.cwd());
  const excludedPids = new Set([process.pid, process.ppid]);
  const processes = listNodeProcessesOnWindows();

  const projectProcesses = processes.filter((item) =>
    normalizePathForMatch(item.commandLine).includes(projectRoot)
  );

  const targets = projectProcesses.filter(
    (item) => !shouldSkipProcess(item.pid, item.commandLine, excludedPids)
  );

  let killedCount = 0;
  for (const item of targets) {
    if (killProcessTreeOnWindows(item.pid)) {
      killedCount += 1;
    }
  }

  console.log(
    `[dev:clean-node] project=${path.basename(process.cwd())}, matched=${projectProcesses.length}, killed=${killedCount}`
  );
}

function cleanupNodeProcessesOnUnix() {
  const projectRoot = process.cwd().toLowerCase();
  const output = execSync("ps -ax -o pid=,command=", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });

  const lines = output.split(/\r?\n/).map((line) => line.trim());
  const excludedPids = new Set([process.pid, process.ppid]);

  const targets = lines
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(\d+)\s+(.+)$/);
      if (!match) {
        return null;
      }
      return {
        pid: Number.parseInt(match[1], 10),
        commandLine: match[2],
      };
    })
    .filter((item) => item && Number.isFinite(item.pid))
    .filter((item) => item.commandLine.toLowerCase().includes("node"))
    .filter((item) => item.commandLine.toLowerCase().includes(projectRoot))
    .filter((item) => !excludedPids.has(item.pid));

  let killedCount = 0;
  for (const item of targets) {
    try {
      process.kill(item.pid, "SIGTERM");
      killedCount += 1;
    } catch {
      // Ignore race conditions on process exit.
    }
  }

  console.log(
    `[dev:clean-node] project=${path.basename(process.cwd())}, killed=${killedCount}`
  );
}

if (process.platform === "win32") {
  cleanupNodeProcessesOnWindows();
} else {
  cleanupNodeProcessesOnUnix();
}
