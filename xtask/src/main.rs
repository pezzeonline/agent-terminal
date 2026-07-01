// Project-level task runner. Follows the wider Rust community's
// `cargo xtask` convention: a small binary crate that holds project-level
// scripts (codegen, deploy hooks, release automation) written in Rust
// instead of shell / Make / justfile. Ergonomic via `cargo xtask …` thanks
// to the alias in `.cargo/config.toml`.

use anyhow::Result;
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "xtask", about = "Project-level task runner")]
struct Cli {
    #[command(subcommand)]
    command: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Regenerate the TypeScript wire-protocol bindings from
    /// `src-tauri/src/protocol.rs`. Run this after editing that file so
    /// `companion/src/modules/wss/protocol.gen.ts` stays in sync.
    RegenProtocol,
}

fn main() -> Result<()> {
    match Cli::parse().command {
        Cmd::RegenProtocol => regen_protocol(),
    }
}

fn regen_protocol() -> Result<()> {
    // Wiring lands in the next commit — for now this proves the CLI
    // dispatch works and the subcommand is discoverable via `--help`.
    println!("xtask regen-protocol: implementation follows in a subsequent commit");
    Ok(())
}
