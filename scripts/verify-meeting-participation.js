#!/usr/bin/env node

const {
  verifyHostedMeetingHubParticipationTabsSearchAndHide,
  verifyMeetingParticipationAccessFlow,
  verifyMeetingParticipationRulesAndIndexes,
} = require("../test-support/verify-meeting-participation-support");

async function main() {
  await verifyMeetingParticipationAccessFlow();
  await verifyHostedMeetingHubParticipationTabsSearchAndHide();
  verifyMeetingParticipationRulesAndIndexes();
  console.log("[verify-meeting-participation] Meeting participation shortcut contract passed");
}

main().catch((error) => {
  console.error(`[verify-meeting-participation] ${error.stack || error.message}`);
  process.exit(1);
});
