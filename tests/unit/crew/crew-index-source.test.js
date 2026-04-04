"use strict";

const fs = require("fs");
const path = require("path");

describe("crew/index.html source", () => {
  test("the crew shell loads the real field runtime instead of executing the legacy demo inline", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "crew/index.html"),
      "utf8"
    );

    expect(source).toContain('type="text/plain" id="crewLegacyDemoSource"');
    expect(source).toContain('/crew/crew.js?v=20260403-real-field');
    expect(source).toContain('id="screenSchedule"');
    expect(source).toContain('id="screenSuccess"');
    expect(source).toContain('id="loginError"');
    expect(source).toContain('id="offlineIndicator"');
    expect(source).toContain('id="bottomNav"');
    expect(source).toContain('id="btnJobBack"');
    expect(source).toContain('id="btnScheduleBack"');
    expect(source).toContain('id="btnSaveCrewNotes"');
    expect(source).toContain('id="confirmCancel"');
  });
});
