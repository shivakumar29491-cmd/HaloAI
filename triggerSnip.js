const { exec } = require("child_process");

function triggerSnip() {
  // Opens Windows Snipping Tool in region mode
  exec("explorer.exe ms-screenclip:");
}

module.exports = { triggerSnip };
