// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the Apache 2.0 license found in the LICENSE file or at:
//     https://opensource.org/licenses/Apache-2.0

import { reactRouter } from "@react-router/dev/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { mkdir, symlink } from "node:fs/promises";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [
    cloudflare({ viteEnvironment: { name: "ssr" } }),
    tailwindcss(),
    reactRouter(),
    tsconfigPaths(),
    {
      name: "react-router-cloudflare-output",
      apply: "build",
      sharedDuringBuild: true,
      async writeBundle() {
        if (this.environment.name !== "client") return;
        // React Router reads client assets from build/client; cf emits Build Output.
        await mkdir("build", { recursive: true });
        await symlink(resolve(this.environment.config.build.outDir), "build/client", "dir");
      },
    },
  ],
});
