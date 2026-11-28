# mjai HUD

For the complete numbered installation and start-up instructions, open [README.md](../README.md).

This Chrome extension observes Mahjong Soul WebSocket traffic and shows recommendations from the local bridge. Optional autoplay sends selected game operations through the active game connection after the user enables it. It normally detects your seat from the game connection automatically; if that fails, the main guide explains the manual option.

The extension keeps a bounded copy of the current round in memory while the game page remains open. If the local bridge or extension service worker reconnects, it sends that copy again so the bridge can rebuild state. It also forwards game reconnect/restore data where available. If the game connection is interrupted, refresh the game page and allow it to reconnect; recovery depends on the game providing a complete restore history. If the display says the state is incomplete or the seat could not be detected, follow the troubleshooting steps in the main guide.

The main-world observer forwards action notifications and the responses to game sync/enter requests. It replaces those outgoing requests with a stripped copy containing only the method and message ID. Authentication traffic and login tokens are not forwarded; the observer uses the account number and seat list only to calculate your seat, then discards the account number. History remains in memory and is discarded when the game socket closes or the page is closed.

The extension supports game pages at `game.maj-soul.com`, `game.maj-soul.net`, and `mahjongsoul.game.yo-star.com`. It observes WebSockets created in the page; sockets created inside workers or native processes are not covered. The overlay can display canvas-relative highlights when the bridge identifies a position. Suggestions have been observed in a live game; highlight alignment and all game variants still require verification.

Run the extension checks with:

```sh
node --test tests/*.test.cjs
```

## Green highlights

When the bridge supplies an inferred tile position, the HUD marks it with a passive green outline. It can also mark an action button when the bridge supplies an action slot. If the position cannot be determined, the text suggestion remains visible without an outline. The default canvas layout is an estimate based on a 16:9 game view; check alignment before relying on it.

If the outline does not align, click **Adjust highlight** in the HUD. Choose **Preview first tile** or **Preview rightmost action**, then use the sliders to move and resize the yellow preview to match your game view. Click **Done adjusting**. These settings are saved by the extension. **Reset positions** restores the defaults. Adjust both previews if using both kinds of highlight. When autoplay is enabled, the extension may also use the highlighted position for its input fallback.
