import asyncio
import os
import secrets
import sys
from pathlib import Path

from aiohttp import WSMsgType, web

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "net"))

from multiplayer import ZK_AVAILABLE, zk_commit, zk_prove, zk_verify

WEB = Path(__file__).resolve().parent
FLEET_SIZE = 17
ASSETS = {"app.js", "axis.css", "modal.css", "styles.css"}


class Room:
    def __init__(self):
        self.players = []
        self.turn = 0
        self.done = False


def valid_board(board):
    return isinstance(board, list) and len(board) == 100 and all(cell in (0, 1) for cell in board) and sum(board) == FLEET_SIZE


async def send(player, message):
    await player["ws"].send_json(message)


async def start(room):
    for index, player in enumerate(room.players):
        await send(player, {
            "type": "ready",
            "player": index,
            "turn": index == room.turn,
            "commitment": player["commitment"],
            "opponent_commitment": room.players[1 - index]["commitment"],
        })


async def shot(room, player, row, col):
    index = room.players.index(player)
    if room.done or index != room.turn:
        raise ValueError("not your turn")
    if not isinstance(row, int) or not isinstance(col, int) or not 0 <= row < 10 or not 0 <= col < 10:
        raise ValueError("invalid coordinate")
    cell = row * 10 + col
    if cell in player["shots"]:
        raise ValueError("coordinate already fired upon")
    player["shots"].add(cell)
    defender = room.players[1 - index]
    result = await asyncio.to_thread(zk_prove, defender["board"], defender["salt"], row, col)
    if not result:
        raise RuntimeError("proof generation failed")
    hit = str(int(defender["board"][cell] == 1))
    expected = [defender["commitment"], str(row), str(col), hit]
    if ([str(value) for value in result["public"]] != expected
            or result["is_hit"] != hit
            or not await asyncio.to_thread(zk_verify, result["proof"], result["public"])):
        raise RuntimeError("proof verification failed")
    player["hits"] += int(hit)
    if player["hits"] == FLEET_SIZE:
        room.done = True
        for opponent_index, opponent in enumerate(room.players):
            await send(opponent, {"type": "game_over", "winner": index})
        return
    room.turn = 1 - room.turn
    await send(player, {
        "type": "result",
        "row": row,
        "col": col,
        "hit": hit,
        "turn": False,
        "commitment": defender["commitment"],
        "proof": result["proof"],
        "public": result["public"],
    })
    await send(defender, {"type": "defense", "row": row, "col": col, "hit": hit, "turn": True})


async def forfeit(room, player):
    if room.done:
        return
    room.done = True
    winner = 1 - room.players.index(player)
    for opponent in room.players:
        await send(opponent, {"type": "game_over", "winner": winner})


async def websocket(request):
    if not ZK_AVAILABLE:
        return web.Response(status=503, text="ZK artifacts are unavailable")
    ws = web.WebSocketResponse(max_msg_size=1 << 20)
    await ws.prepare(request)
    player = None
    room = None
    try:
        async for message in ws:
            if message.type != WSMsgType.TEXT:
                continue
            data = message.json()
            if data.get("type") == "join" and player is None:
                room_id = data.get("room", "")
                board = data.get("board")
                if not isinstance(room_id, str) or not room_id.isalnum() or len(room_id) > 32 or not valid_board(board):
                    raise ValueError("invalid room or board")
                room = request.app["rooms"].setdefault(room_id, Room())
                if len(room.players) == 2:
                    raise ValueError("room is full")
                salt = str(secrets.randbits(248))
                commitment = await asyncio.to_thread(zk_commit, board, salt)
                if not commitment:
                    raise RuntimeError("commitment generation failed")
                player = {"ws": ws, "board": board, "salt": salt, "commitment": commitment, "shots": set(), "hits": 0}
                room.players.append(player)
                if len(room.players) == 1:
                    await send(player, {"type": "waiting"})
                else:
                    await start(room)
            elif data.get("type") == "shot" and player is not None and room is not None:
                await shot(room, player, data.get("row"), data.get("col"))
            elif data.get("type") == "forfeit" and player is not None and room is not None:
                await forfeit(room, player)
            else:
                raise ValueError("invalid message")
    except (RuntimeError, ValueError) as error:
        await send(player or {"ws": ws}, {"type": "error", "message": str(error)})
    finally:
        if room and player in room.players:
            room.players.remove(player)
            for opponent in room.players:
                await send(opponent, {"type": "peer_left"})
            if not room.players:
                request.app["rooms"].pop(next(key for key, value in request.app["rooms"].items() if value is room), None)
    return ws


async def index(request):
    return web.FileResponse(WEB / "index.html")


async def asset(request):
    name = request.match_info["name"]
    if name not in ASSETS:
        raise web.HTTPNotFound()
    return web.FileResponse(WEB / name)


async def health(request):
    return web.json_response({"zk_available": ZK_AVAILABLE})


def app():
    application = web.Application()
    application["rooms"] = {}
    application.router.add_get("/ws", websocket)
    application.router.add_get("/health", health)
    application.router.add_get("/", index)
    application.router.add_get("/{name}", asset)
    return application


if __name__ == "__main__":
    web.run_app(app(), port=int(os.environ.get("PORT", "8080")))
