const { ipcRenderer } = require('electron');

let startX = 0;
let startY = 0;
let isDragging = false;

const box = document.getElementById("selectionBox");

window.addEventListener("mousedown", (e) => {
  isDragging = true;
  startX = e.clientX;
  startY = e.clientY;

  box.style.left = `${startX}px`;
  box.style.top = `${startY}px`;
  box.style.width = "0px";
  box.style.height = "0px";
  box.style.display = "block";
});

window.addEventListener("mousemove", (e) => {
  if (!isDragging) return;

  const x = Math.min(e.clientX, startX);
  const y = Math.min(e.clientY, startY);
  const w = Math.abs(e.clientX - startX);
  const h = Math.abs(e.clientY - startY);

  box.style.left = `${x}px`;
  box.style.top = `${y}px`;
  box.style.width = `${w}px`;
  box.style.height = `${h}px`;
});

window.addEventListener("mouseup", (e) => {
  if (!isDragging) return;
  isDragging = false;

  const rect = {
    x: parseInt(box.style.left),
    y: parseInt(box.style.top),
    width: parseInt(box.style.width),
    height: parseInt(box.style.height)
  };

  ipcRenderer.send("screenread:selection", rect);

  window.close(); // closes overlay window
});
