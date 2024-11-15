import { execSync } from "child_process";
import readline from "readline";
import fs from "fs";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function runCommand(command) {
  try {
    execSync(command, { stdio: "inherit" });
  } catch (error) {
    console.error(`Error executing command: ${command}`);
    console.error(error);
    process.exit(1);
  }
}

console.log("Pulling latest changes from git...");
runCommand("git pull");

console.log("Installing dependencies...");
runCommand("yarn install");

rl.question(
  "Do you want to try migrating the database? (default: will recreate if n) (y/N): ",
  (answer) => {
    if (answer.toLowerCase() === "y") {
      console.log("Migrating database...");
      runCommand("yarn generate");
      runCommand("yarn migrate");
    } else {
      console.log("Removing existing database...");
      try {
        fs.unlinkSync("data.db"); // Replace with your actual database file name
      } catch (error) {
        console.log("No existing database found or error removing it.");
      }

      console.log("Regenerating database...");
      runCommand("yarn generate");
      runCommand("yarn migrate");
    }

    console.log("\nUpdate process completed.");
    rl.close();
  }
);
