import { existsSync } from "node:fs";
import { resolve, delimiter } from "node:path";
import { spawnSync } from "node:child_process";

// A project-local toolchain is optional; Windows and CI use the normal Rust installation.
const env = { ...process.env };
const localCargo = resolve(".tools/cargo");
if (
  existsSync(
    resolve(
      localCargo,
      "bin",
      process.platform === "win32" ? "cargo.exe" : "cargo",
    ),
  )
) {
  env.CARGO_HOME = localCargo;
  env.RUSTUP_HOME = resolve(".tools/rustup");
  env.PATH = resolve(localCargo, "bin") + delimiter + (env.PATH ?? "");
}
const [command, ...args] = process.argv.slice(2);
const result =
  command === "cargo"
    ? spawnSync("cargo", args, { env, stdio: "inherit" })
    : spawnSync(
        process.execPath,
        [resolve("node_modules/@tauri-apps/cli/tauri.js"), command, ...args],
        { env, stdio: "inherit" },
      );
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
