# Sidemate 0.4.0

0.4 is a minor update: you can preview results and materials inside Sidemate; charts, flowcharts, formulas and images show up right in the conversation; news is now "one sentence plus a time", and you can subscribe to several topics; the island moves more smoothly and changes its look while it works.

This version still supports Windows only.

## Upgrading from 0.3

- Just install the new version; no need to uninstall first. Your key, conversations, news and settings from 0.3 carry over, with nothing to set up again.
- **News**: all your 0.3 topics are kept. If you had several, each topic's name and what-to-read are merged into one sentence, such as "AI 行业：大模型和 AI 应用的最新动态", and the old `news.json` is backed up as `news.json.bak-0.4`. Topic names are now summarized from that sentence automatically, and you can edit them.
- **Missed news is no longer made up later**: the "Catch up after sleep" switch is gone. If the computer is asleep or Sidemate is not running at the set time, that issue is skipped, and the day shows "未生成：桌伴未运行" under News in the right-click menu. Use "Generate now" in Settings if you want it.
- If you have used the Kilo model: the Kilo model notice is now version 1.1, and the next time you use Kilo you will be asked to read it and agree again.

## New

- **Preview**: click "Preview" on a result card, or the preview button at the top right of the task window, to read Word, PowerPoint, PDF, Excel, image and web files inside Sidemate, without opening another program.
  - The left side lists this conversation's results and materials; click one to view it.
  - Zoom from the bottom bar: fit to width, or 50% to 200%; Ctrl plus the mouse wheel works too.
  - At the top: "Open", "Show in folder" and "Save as". Right-clicking a result card also offers "Preview", "Open", "Show in folder" and "Save as".
- **Visuals in the conversation**: the model can draw bar, line and pie charts and flowcharts right in its reply, and show formulas and images from the workspace. Right-click a chart to save it as an image or copy it.
- **News**:
  - One card per topic: say what you want to read in a sentence, then pick how often (every day, weekdays, Mondays) and the time. Up to 5 topics.
  - The topic name is summarized from that sentence, up to 8 characters; click it to change it yourself.
  - After "Generate now" you can see progress: the card shows how long it has been running, and the island switches to its working look. When it finishes, the card shows the time and how many items, and "View" opens it.
  - One switch for the whole page decides whether background runs may run commands or change files. It is off by default.
- **Task list**: in the "任务列表" list at the top left, each conversation's time now has a mark next to it: a spinner while it is still running, a green dot when it finished in the background and you have not looked yet.

## Improved

- **The island**: its eyes now move on springs, so changing expressions no longer jumps; while working it changes its look as it reads, thinks and writes; after 10 minutes without activity it dozes off, then falls asleep, and wakes up slowly when the mouse comes near. On high-refresh-rate screens the animation is capped at 60 frames per second; when the computer is very busy, the island stops its small idle movements first.
- **Replies appear as they are written**, without waiting for the whole paragraph.
- **Smoother with several tasks at once**: Sidemate could freeze for a moment when several tasks ran together; this is fixed.
- **When a tool fails now and then**, the conversation no longer shows a separate "call failed" line; the model tries another way and carries on.
- **When it hands you a file**: ask it to write something meant to be handed on, such as a notice or a report, and you get a Word file; ask it to look something up, answer a question or make a list, and it answers in the conversation.
- **Office results are checked before they are handed over**: it does not make up times, places or numbers that are not in your materials, writes "TBD" and tells you instead, and writes totals and month-on-month changes in Excel as formulas.
- **Settings**: deleting a model, skill, outside tool or news topic now asks in a small dialog inside the window; every first-run screen is centered in the window.

## Install

1. Download `sidemate-setup-0.4.0.exe` below and double-click it. The installer is not signed; when Windows warns you, click "More info", then "Run anyway".
2. First launch: read the short introduction and click "Start"; paste your DeepSeek API key and click "Test", or set up another model yourself. Once the test passes, you are ready.
3. Upgrading from 0.3: just install; see "Upgrading from 0.3" above.

## Uninstall

Uninstalling asks once: "确定卸载桌伴吗？" Below it is an option, unchecked by default, to also delete all settings and records (including the files created in tasks; this cannot be undone). Leave it unchecked to remove only the program and keep your conversations and files.

## Known issues

- After a conversation is done and you leave it, the copies of the files you dropped in are cleaned up, so the preview window only shows the results; open the original files to see your materials.
- The very first launch right after installing may freeze for a second or two.
- The installer is not signed, so Windows stops it the first time.
- Tested on Windows 10 / 11 only.

## Privacy

Sidemate has no account and no server, and collects no usage data. When you use the Kilo model, your content is sent to Kilo AI for processing. See [PRIVACY.en.md](../PRIVACY.en.md).
