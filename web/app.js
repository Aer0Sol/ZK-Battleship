const fleet = [
  ["Carrier", 5], ["Battleship", 4], ["Cruiser", 3], ["Submarine", 3], ["Destroyer", 2]
];
const state = { board: Array(100).fill(0), target: Array(100).fill(0), placed: [], selected: 0, horizontal: true, engaged: false, turn: false, joining: false, socket: null, player: -1, latestProof: null, committedBoard: null, integrityTimer: null };
const ownGrid = document.querySelector("#own-grid");
const targetGrid = document.querySelector("#target-grid");
const fleetList = document.querySelector("#fleet-list");
const log = document.querySelector("#event-log");
const status = document.querySelector("#match-status");
const detail = document.querySelector("#status-detail");
const engage = document.querySelector("#engage");
const commitment = document.querySelector("#commitment-state");
const modal = document.querySelector("#outcome-modal");
const proofModal = document.querySelector("#proof-modal");
const viewProof = document.querySelector("#view-proof");
const rotate = document.querySelector("#rotate");
const randomize = document.querySelector("#randomize");
const clearBoard = document.querySelector("#clear-board");
const newMatch = document.querySelector("#new-match");
const forfeitButton = document.querySelector("#forfeit");

function cells(row, col, length, horizontal) {
  return Array.from({ length }, (_, i) => (row + (horizontal ? 0 : i)) * 10 + col + (horizontal ? i : 0));
}
function valid(indices, board = state.board, horizontal = state.horizontal) {
  return indices.every(i => i >= 0 && i < 100 && !board[i]) && (!horizontal || new Set(indices.map(i => Math.floor(i / 10))).size === 1);
}
function renderFleet() {
  fleetList.replaceChildren(...fleet.map(([name, length], index) => {
    const button = document.createElement("button");
    button.className = `ship-choice ${state.selected === index ? "active" : ""} ${state.placed[index] ? "placed" : ""}`;
    button.disabled = Boolean(state.placed[index]) || state.joining || state.engaged;
    button.innerHTML = `<span>${name}<small> · ${length} cells</small></span><span class="ship-pips">${"◆".repeat(length)}</span>`;
    button.onclick = () => { state.selected = index; renderFleet(); };
    return button;
  }));
}
function renderGrid(grid, values, own) {
  grid.replaceChildren(...values.map((value, index) => {
    const cell = document.createElement("button");
    cell.className = `cell ${value === 1 && own ? "ship" : ""} ${value === 2 ? "hit" : ""} ${value === 3 ? "miss" : ""}`;
    cell.setAttribute("aria-label", `${String.fromCharCode(65 + index % 10)}${Math.floor(index / 10) + 1}`);
    cell.onclick = () => own ? place(index) : fire(index);
    if (own) {
      cell.onmouseenter = () => preview(index);
      cell.onmouseleave = clearPreview;
    }
    return cell;
  }));
}
function clearPreview() {
  ownGrid.querySelectorAll(".preview,.preview-invalid").forEach(cell => cell.classList.remove("preview", "preview-invalid"));
}
function preview(index) {
  clearPreview();
  if (state.engaged || state.placed[state.selected]) return;
  const length = fleet[state.selected][1];
  const indices = cells(Math.floor(index / 10), index % 10, length, state.horizontal);
  const className = valid(indices) ? "preview" : "preview-invalid";
  indices.filter(i => i >= 0 && i < 100).forEach(i => ownGrid.children[i].classList.add(className));
}
function render() {
  renderFleet();
  renderGrid(ownGrid, state.board, true);
  renderGrid(targetGrid, state.target, false);
  targetGrid.classList.toggle("locked", !state.engaged || !state.turn);
  engage.disabled = state.placed.length !== fleet.length || state.engaged || state.joining;
  viewProof.disabled = !state.latestProof;
  const locked = state.joining || state.engaged;
  rotate.disabled = locked;
  randomize.disabled = locked;
  clearBoard.disabled = locked;
  newMatch.disabled = locked;
  forfeitButton.disabled = !state.engaged;
}
function place(index) {
  if (state.engaged || state.placed[state.selected]) return;
  const ship = fleet[state.selected], row = Math.floor(index / 10), col = index % 10, length = ship[1];
  const indices = cells(row, col, length, state.horizontal);
  if (!valid(indices)) { log.textContent = "That vessel does not fit there."; return; }
  indices.forEach(i => state.board[i] = 1);
  state.placed[state.selected] = { row, col, length, horizontal: state.horizontal };
  state.selected = state.placed.findIndex(x => !x);
  if (state.selected < 0) state.selected = 0;
  log.textContent = `${ship[0]} deployed.`;
  render();
}
function randomBoard() {
  const board = Array(100).fill(0), placements = [];
  fleet.forEach(([, length]) => {
    let indices, horizontal;
    do { horizontal = Math.random() > .5; indices = cells(Math.floor(Math.random() * 10), Math.floor(Math.random() * 10), length, horizontal); } while (!valid(indices, board, horizontal));
    indices.forEach(i => board[i] = 1); placements.push(indices);
  });
  return [board, placements];
}
function fire(index) {
  if (!state.engaged || !state.turn || state.target[index]) return;
  state.turn = false;
  document.querySelector("#turn-badge").textContent = "OPPONENT TURN";
  log.textContent = "Generating proof response…";
  render();
  state.socket.send(JSON.stringify({ type: "shot", row: Math.floor(index / 10), col: index % 10 }));
}
function finish(won) {
  clearInterval(state.integrityTimer);
  state.integrityTimer = null;
  state.engaged = false;
  state.turn = false;
  status.textContent = won ? "Victory" : "Defeat";
  detail.textContent = won ? "All enemy vessels sunk." : "Your fleet was sunk.";
  document.querySelector("#turn-badge").textContent = "COMPLETE";
  document.querySelector("#outcome-kicker").textContent = won ? "MATCH COMPLETE" : "FLEET LOST";
  document.querySelector("#outcome-title").textContent = won ? "You won." : "You lost.";
  document.querySelector("#outcome-detail").textContent = won ? "Every opposing vessel has been confirmed sunk." : "The opposing fleet sank every one of your ships.";
  modal.hidden = false;
  render();
}
function reset() {
  clearInterval(state.integrityTimer);
  state.socket?.close();
  Object.assign(state, { board: Array(100).fill(0), target: Array(100).fill(0), placed: [], selected: 0, horizontal: true, engaged: false, turn: false, joining: false, socket: null, player: -1, latestProof: null, committedBoard: null, integrityTimer: null });
  status.textContent = "Fleet deployment"; detail.textContent = "Place all five ships to begin."; commitment.textContent = "Pending fleet placement"; log.textContent = "Select a vessel to start deployment."; render();
  document.querySelector("#turn-badge").textContent = "LOCKED";
  modal.hidden = true;
  proofModal.hidden = true;
}
function changedBoard() {
  return state.committedBoard && state.board.some((value, index) => Number(value === 1 || value === 2) !== state.committedBoard[index]);
}
function forfeit() {
  if (!state.engaged && !state.joining) return;
  if (state.socket?.readyState === WebSocket.OPEN) state.socket.send(JSON.stringify({ type: "forfeit" }));
  finish(false);
}
function changingBoard() {
  if (!state.engaged && !state.joining) return false;
  forfeit();
  return true;
}
function watchBoard() {
  clearInterval(state.integrityTimer);
  state.integrityTimer = setInterval(() => { if (changedBoard()) forfeit(); }, 250);
}
rotate.onclick = () => { if (changingBoard()) return; state.horizontal = !state.horizontal; log.textContent = `Orientation: ${state.horizontal ? "horizontal" : "vertical"}.`; };
clearBoard.onclick = () => { if (!changingBoard()) reset(); };
newMatch.onclick = () => { if (!changingBoard()) reset(); };
randomize.onclick = () => { if (changingBoard()) return; const [board, placements] = randomBoard(); state.board = board; state.placed = fleet.map(([, length], i) => ({ length, cells: placements[i] })); log.textContent = "Fleet randomized."; render(); };
async function connect(room) {
  try {
    const health = await fetch("/health");
    const healthStatus = await health.json();
    if (!healthStatus.zk_available) throw new Error("ZK artifacts unavailable. Run scripts/setup.sh on the host.");
  } catch (error) {
    state.joining = false;
    status.textContent = "Gateway unavailable";
    detail.textContent = error.message;
    log.textContent = error.message;
    render();
    return;
  }
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  state.socket = new WebSocket(`${scheme}://${location.host}/ws`);
  state.socket.onopen = () => state.socket.send(JSON.stringify({ type: "join", room, board: state.board }));
  state.socket.onmessage = event => receive(JSON.parse(event.data));
  state.socket.onerror = () => { state.joining = false; log.textContent = "Connection failed."; render(); };
  state.socket.onclose = () => { if (state.joining) { state.joining = false; render(); } };
}
function receive(message) {
  if (message.type === "waiting") { status.textContent = "Waiting for opponent"; detail.textContent = "Share the room code with your opponent."; log.textContent = "Fleet committed. Waiting for a second player."; return; }
  if (message.type === "ready") { state.player = message.player; state.engaged = true; state.joining = false; state.turn = message.turn; state.committedBoard = state.board.map(value => Number(value === 1)); watchBoard(); status.textContent = "Engaged"; detail.textContent = state.turn ? "Select an opponent cell to fire." : "Opponent has the first shot."; commitment.textContent = `Committed · ${message.commitment.slice(0, 16)}…`; document.querySelector("#turn-badge").textContent = state.turn ? "YOUR TURN" : "OPPONENT TURN"; log.textContent = "Both commitments verified. Match started."; render(); return; }
  if (message.type === "result") { const index = message.row * 10 + message.col; state.target[index] = Number(message.hit) ? 2 : 3; state.turn = message.turn; state.latestProof = { commitment: message.commitment, public: message.public, proof: message.proof }; document.querySelector("#turn-badge").textContent = "OPPONENT TURN"; log.textContent = `${String.fromCharCode(65 + message.col)}${message.row + 1}: ${message.hit === "1" ? "verified hit" : "verified miss"}.`; render(); return; }
  if (message.type === "defense") { const index = message.row * 10 + message.col; state.board[index] = Number(message.hit) ? 2 : 3; state.turn = message.turn; document.querySelector("#turn-badge").textContent = "YOUR TURN"; log.textContent = `Opponent fired at ${String.fromCharCode(65 + message.col)}${message.row + 1}: ${message.hit === "1" ? "hit" : "miss"}.`; render(); return; }
  if (message.type === "game_over") return finish(message.winner === state.player);
  if (message.type === "peer_left") { state.engaged = false; state.turn = false; status.textContent = "Opponent disconnected"; detail.textContent = "Start a new match when they return."; log.textContent = "Connection closed by opponent."; render(); return; }
  if (message.type === "error") { state.joining = false; status.textContent = "Match error"; detail.textContent = message.message; log.textContent = message.message; render(); }
}
engage.onclick = () => { const room = prompt("Enter a room code to share with your opponent.", location.hash.slice(1) || ""); if (!room) return; location.hash = room; state.committedBoard = state.board.map(value => Number(value === 1)); state.joining = true; watchBoard(); status.textContent = "Connecting"; detail.textContent = "Creating secure match room…"; log.textContent = "Connecting to game gateway…"; render(); connect(room); };
document.querySelector("#play-again").onclick = reset;
forfeitButton.onclick = forfeit;
viewProof.onclick = () => { document.querySelector("#proof-data").textContent = JSON.stringify(state.latestProof, null, 2); proofModal.hidden = false; };
document.querySelector("#close-proof").onclick = () => { proofModal.hidden = true; };
document.querySelector("#copy-proof").onclick = async () => { await navigator.clipboard.writeText(JSON.stringify(state.latestProof, null, 2)); document.querySelector("#copy-proof").textContent = "Copied"; };
window.addEventListener("keydown", event => { if (event.key.toLowerCase() === "r") document.querySelector("#rotate").click(); });
render();
