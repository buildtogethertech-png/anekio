// PM2 process for the API + web app. Started by deploy/push.sh.
// Env comes from the shared .env on every reload: `--update-env` only refreshes keys listed here.
const fs = require("fs");
const dotenv = require("dotenv");
const fileEnv = dotenv.parse(fs.readFileSync("/srv/anekio/shared/.env"));

module.exports = {
  apps: [
    {
      name: "anekio",
      cwd: "/srv/anekio/current",
      script: "dist/server.cjs",
      node_args: "--max-old-space-size=900 --enable-source-maps",
      env: { ...fileEnv, NODE_ENV: "production", PORT: "4000" },
      max_memory_restart: "1100M",
      out_file: "/var/log/anekio/out.log",
      error_file: "/var/log/anekio/error.log",
      time: true,
    },
  ],
};
