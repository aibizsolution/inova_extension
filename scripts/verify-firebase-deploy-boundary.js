const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const FUNCTION_CODEBASE = "inova-extension-api";
const FIRESTORE_DATABASE = "(default)";
const HOSTING_TARGETS = ["main", "v2"];
const EXPECTED_DEPLOY_SCRIPTS = {
  "deploy:hosting": "firebase deploy --only hosting:main,hosting:v2",
  "deploy:functions": "firebase deploy --only functions:inova-extension-api",
  "deploy:firestore:inova-db": "firebase deploy --only \"firestore:(default)\"",
  "deploy:all": "firebase deploy --only hosting:main,hosting:v2,functions:inova-extension-api",
  "release:deploy": "npm run release:build && firebase deploy --only hosting:main,hosting:v2",
  "release:deploy:all": "npm run release:build && firebase deploy --only hosting:main,hosting:v2,functions:inova-extension-api",
};

const failures = [];

function readJson(relativePath) {
  const absolutePath = path.join(ROOT_DIR, relativePath);
  return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
}

function fail(message) {
  failures.push(message);
}

function toArray(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function trimQuotes(value) {
  return value.replace(/^["']|["']$/g, "");
}

function extractFirebaseDeployOnlyValues(command) {
  const values = [];
  const segments = command.split(/\s*(?:&&|\|\||;)\s*/);

  for (const segment of segments) {
    if (!/\bfirebase\s+deploy\b/.test(segment)) {
      continue;
    }

    const onlyMatch = segment.match(/--only\s+("[^"]+"|'[^']+'|[^\s]+)/);
    if (!onlyMatch) {
      values.push(null);
      continue;
    }

    values.push(trimQuotes(onlyMatch[1]));
  }

  return values;
}

const firebaseConfig = readJson("firebase.json");
const packageJson = readJson("package.json");

const functionConfigs = toArray(firebaseConfig.functions);
if (functionConfigs.length !== 1) {
  fail("firebase.json must keep a single inova_extension functions config.");
} else {
  const functionConfig = functionConfigs[0];
  if (functionConfig.source !== "functions") {
    fail("firebase.json functions.source must remain functions.");
  }
  if (functionConfig.codebase !== FUNCTION_CODEBASE) {
    fail(`firebase.json functions.codebase must be ${FUNCTION_CODEBASE}.`);
  }
}

const hostingConfigs = toArray(firebaseConfig.hosting);
const hostingTargets = new Set();
for (const hostingConfig of hostingConfigs) {
  if (hostingConfig.site) {
    fail("firebase.json hosting configs must use deploy targets, not raw site ids.");
  }
  if (hostingConfig.target) {
    hostingTargets.add(hostingConfig.target);
  }
}

for (const target of HOSTING_TARGETS) {
  if (!hostingTargets.has(target)) {
    fail(`firebase.json hosting target ${target} is required.`);
  }
}

const firestoreConfigs = toArray(firebaseConfig.firestore);
if (firestoreConfigs.length !== 1) {
  fail("firebase.json must keep a single inova_extension Firestore database config.");
} else {
  const firestoreConfig = firestoreConfigs[0];
  if (firestoreConfig.database !== FIRESTORE_DATABASE) {
    fail(`firebase.json firestore.database must remain ${FIRESTORE_DATABASE}.`);
  }
  if (firestoreConfig.rules !== "firestore.rules") {
    fail("firebase.json Firestore rules must remain firestore.rules.");
  }
  if (firestoreConfig.indexes !== "firestore.indexes.json") {
    fail("firebase.json Firestore indexes must remain firestore.indexes.json.");
  }
}

const scripts = packageJson.scripts || {};
for (const [scriptName, expectedCommand] of Object.entries(EXPECTED_DEPLOY_SCRIPTS)) {
  if (scripts[scriptName] !== expectedCommand) {
    fail(`package.json script ${scriptName} must be: ${expectedCommand}`);
  }
}

if (Object.prototype.hasOwnProperty.call(scripts, "deploy:firestore")) {
  fail("Use deploy:firestore:inova-db instead of deploy:firestore.");
}

if (Object.prototype.hasOwnProperty.call(scripts, "deploy:storage")) {
  fail("Do not add a broad deploy:storage script; storage deploys require a dedicated target.");
}

for (const [scriptName, command] of Object.entries(scripts)) {
  const deployOnlyValues = extractFirebaseDeployOnlyValues(command);
  for (const onlyValue of deployOnlyValues) {
    if (onlyValue === null) {
      fail(`package.json script ${scriptName} runs firebase deploy without --only.`);
      continue;
    }

    const deployTargets = onlyValue.split(",").map((item) => item.trim()).filter(Boolean);
    for (const deployTarget of deployTargets) {
      if (deployTarget === "functions") {
        fail(`package.json script ${scriptName} must not deploy all functions.`);
      }
      if (deployTarget.startsWith("functions:") && deployTarget !== `functions:${FUNCTION_CODEBASE}`) {
        fail(`package.json script ${scriptName} must deploy functions via functions:${FUNCTION_CODEBASE}.`);
      }
      if (deployTarget === "hosting") {
        fail(`package.json script ${scriptName} must deploy explicit hosting targets.`);
      }
      if (deployTarget.startsWith("hosting:")) {
        const target = deployTarget.slice("hosting:".length);
        if (!HOSTING_TARGETS.includes(target)) {
          fail(`package.json script ${scriptName} uses unknown hosting target ${target}.`);
        }
      }
      if (deployTarget === "firestore") {
        fail(`package.json script ${scriptName} must deploy Firestore by database id.`);
      }
      if (deployTarget.startsWith("firestore:") && deployTarget !== `firestore:${FIRESTORE_DATABASE}`) {
        fail(`package.json script ${scriptName} must deploy Firestore via firestore:${FIRESTORE_DATABASE}.`);
      }
      if (deployTarget === "storage") {
        fail(`package.json script ${scriptName} must deploy Storage by target, not project-wide.`);
      }
      if (deployTarget.startsWith("storage:") && !deployTarget.startsWith("storage:inova-extension-")) {
        fail(`package.json script ${scriptName} must use an inova-extension storage target.`);
      }
    }
  }
}

const docNeedles = [
  ["README.md", FUNCTION_CODEBASE],
  ["docs/firebase-architecture.md", FUNCTION_CODEBASE],
  ["docs/firebase-architecture.md", "Auth만 공유"],
  ["docs/release-workflow.md", "hosting:main,hosting:v2"],
  ["docs/runtime-architecture.md", FUNCTION_CODEBASE],
  ["docs/runtime-architecture.md", FIRESTORE_DATABASE],
];

for (const [relativePath, needle] of docNeedles) {
  const text = fs.readFileSync(path.join(ROOT_DIR, relativePath), "utf8");
  if (!text.includes(needle)) {
    fail(`${relativePath} must document ${needle}.`);
  }
}

if (failures.length > 0) {
  console.error("Firebase deploy boundary verification failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("Firebase deploy boundary verification passed.");
