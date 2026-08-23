# Device-control framework ("orin" CLI)

Lets an AI agent see and operate this Windows machine directly — no sandbox,
no VNC. Built for driving and QA-ing the Orin AI desktop app end-to-end.

## Commands

```
./orin screen [out.png]            capture the whole virtual screen → PNG (then Read it)
./orin move X Y                    move the cursor to physical pixel X,Y
./orin click X Y                   left-click at X,Y        ./orin double X Y
./orin right X Y                   right-click at X,Y
./orin down X Y | up X Y           hold / release left button at X,Y (for custom drags)
./orin drag X1 Y1 X2 Y2            press-move-release drag
./orin scroll X Y AMOUNT           wheel scroll at X,Y (positive = up)
./orin type "text"                 unicode keyboard typing into the focused window
./orin key enter                   single key: enter tab esc backspace del home end
                                   pgup pgdn up down left right space win f1..f12 …
./orin combo ctrl+shift+p          chord: modifiers (+) ending in one key
./orin win list                    windows with titles + PIDs
./orin win activate TITLE          focus the first window whose title contains TITLE
./orin start EXE [ARGS…]           launch a program detached
./orin clipboard TEXT              put text on the clipboard
```

Coordinates are **physical pixels on the virtual (multi-monitor) desktop**, top-left = 0,0.
The scripts set DPI awareness so coordinates match what `screen` captures — read the
PNG, find a target visually, click its exact pixels.

## Typical observe→decide→act loop

```bash
./orin start "C:/.../orin-desktop.exe"     # launch the app under test
sleep 3 && ./orin screen shot.png          # look (Read shot.png as an image)
./orin click 700 400                       # act
./orin type "hello Orin"
./orin combo ctrl+s
./orin screen after.png                    # verify result visually
```
