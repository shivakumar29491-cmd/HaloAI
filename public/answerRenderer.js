const box = document.getElementById("soloAnswer");

function showAnswer(text) {
  box.innerHTML = text.replace(/\n/g, "<br>");
}
