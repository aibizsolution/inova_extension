#!/usr/bin/env node

const { DEFAULT_HOST, DEFAULT_PORT, createCloudHarnessServer } = require("./cloud-harness-server");

async function main() {
  const port = readPort(process.argv.slice(2));
  const harness = createCloudHarnessServer({ host: DEFAULT_HOST, port });
  const { baseUrl, hostingBaseUrl } = await harness.listen();

  console.log(`[cloud-harness] serving local function fixtures at ${baseUrl}`);
  console.log(`[cloud-harness] functions base URL ${baseUrl}`);
  console.log(`[cloud-harness] hosting base URL ${hostingBaseUrl}`);
  console.log("[cloud-harness] press Ctrl+C to stop");
}

function readPort(args) {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--port") {
      const parsed = Number(args[index + 1] || "");
      if (Number.isInteger(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }
  return DEFAULT_PORT;
}

main().catch((error) => {
  console.error(`[cloud-harness] ${error.message}`);
  process.exit(1);
});
