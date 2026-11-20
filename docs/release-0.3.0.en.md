# Sidemate 0.3.0

This project is developed on DeepSeek Harness. Sidemate is your companion: it sits at the top of your screen and shows nothing but a pair of eyes. Version 0.3 supports DeepSeek, Kilo or BYOK (bring your own key), supports Skills and MCP, and adds a news feature that brings you the content you care about at the time you choose.

This version still supports Windows only.

## Read this before upgrading from 0.2

- **0.3 does not read 0.2's key, conversations, news or settings.** 0.3 keeps its data in `%LOCALAPPDATA%\sidemate`. The first time you open it after installing, pick a model and paste your key again, as on a new install.
- **0.2's files are not deleted.** Everything 0.2 wrote, and its own records, stay in `C:\Users\<your user name>\桌伴`. Take what you need from there, or delete the folder yourself.
- **A few 0.2 behaviours changed:**
  - Dropped files are no longer split into a template on the left and materials on the right; they are all just files. If you want it to follow one file's format, say so in your message.
  - It no longer adds a Word comment citing the source of every sentence.
  - Results no longer go into a "桌伴输出" folder. Each result is a card in the conversation: open it, save it elsewhere, or open its folder.

## What it does

### New

- **Multiple model providers**:
  - **DeepSeek**: paste your own API key and pay for what you use; DeepSeek's native tools are supported.
  - **Kilo**: uses Kilo's gateway, with usage limits; see the Kilo notice in the app and Kilo's official terms.
  - **Custom**: enter an address, a model name and an API key; OpenAI-style and Anthropic-style APIs both work.
- **Install Skills, connect MCP** (Settings · Capabilities):
  - **Skills**: import a folder or a .zip. You can also say "install the xxx skill" in a conversation: it first shows a confirmation card with what it will install and where from, and downloads only after you click "Install". Skills installed this way show their source repository, commit and license in Settings.
  - **MCP**: enter a URL, paste a config copied from elsewhere, or enter a local program (command, arguments, environment variables) to connect an outside service. A service's key is given to that service only, never to scripts the model writes.
  - **Built in**: "Writing", plus the recommended "Flowcharts" (flowcharts, responsibility charts and timelines, drawn as boxes and arrows you can edit and move in Word or PowerPoint). Both are on by default.
- **News** (Settings · News):
  - Say what you want to read and when. At that time your model searches and reads the original pages itself, and every item links to a page it actually opened in that run. "Generate now" runs it right away.
  - It needs web search: add a DeepSeek API key, or add a search tool under Capabilities.
  - Each topic has "Auto-grant permissions: allow / deny". With deny, actions that need extra permission while generating are refused, which may make generation fail.
  - The island tells you when news is ready. Right-click the island and choose "News" to browse by topic and day. News stays inside Sidemate; say "turn this into Word" in that news conversation to get a file.
  - If the computer was asleep at the scheduled time, it catches up when it wakes (you can turn this off). Nothing is generated while Sidemate is closed.
- **Task window**:
  - **A word before the work**: after you send, the model says in one sentence what it is about to do, then starts.
  - **Add a message mid-task**: what you type while it works is sent right away.
  - **Result cards**: each file it makes is a card in the conversation. Open it, save it elsewhere, open its folder, or drag it to the desktop or into another program.
  - **Carry on**: after a task is done, typing again or dropping another file into the task window continues the same conversation. "Tasks" at the top left lists earlier conversations; pick one to carry on.
  - **Paste**: paste images directly; long pasted text is saved as a file.
  - **Asks before going further**: when the model wants to do something outside its limits, a card offers "Allow once", "Allow for this task" or "Deny".
  - **Web reading stays off your machine**: when the model reads a link, it cannot reach addresses on this computer or your local network unless you turn on "Allow local network access" in Settings.
- **Recent** (right-click menu): folders you recently worked in and recent tasks, one click to open.
- **Display** (Settings · Display): four text sizes (small, standard, large, extra large) and an adjustable island size. In the task window, Ctrl + plus / minus also changes the text size, and Ctrl + 0 resets it.

### Improved

- **Always-on worker**: the process that does the work stays running, so new tasks start faster. If it crashes it restarts itself, and a task that was running can carry on with "Continue".
- **Clearer errors**: it says which step failed, the likely cause and what to do next, followed by a short code (for example Si901) to include when you report a problem. When the model's service is busy or the connection drops, it waits and retries, with a countdown.
- **Windows**: the first-run, Settings and notice windows have no system title bar, open in the centre of the screen, and have a round close button at the top right.
- **New icon**: a dark rounded square with two eyes, easy to see on a light taskbar.
- **Uninstall asks once**: see "Uninstall" below.

## How to use it

- The island sits on the top edge of the screen; drag it left or right to move it. Hover over it to see a line of text. Its eyes change when something is going on: looking down at the page while it works, smiling when it is done, wide open with a red dot when it is waiting for you.
- Click the island and the task window drops down from under it; click again to fold it away while the work carries on.
- Drag files onto the island and it stretches sideways with "Drop it here"; let go to start something new. Drop files into the task window to continue the current conversation.
- Right-click the island for "News", "New task", "Recent", "Settings" and "Keep on top".
- Settings · Usage shows how much you have used this month and how much each of the last 10 tasks used.

## Install

1. Download `sidemate-setup-0.3.0.exe` below and double-click it. The installer is not signed; when Windows warns you, click "More info", then "Run anyway".
2. On first launch, read the short introduction and click "Start". Then pick a model: paste a DeepSeek key and click "Test", choose GLM or Kilo, or set up your own. Once the test passes you are ready.
3. Upgrading from 0.2? Read the first section: you need to paste your key again.

## Uninstall

Uninstalling asks once, "Uninstall Sidemate?", with one option that is unticked by default: "Also delete all settings and records (including files made in tasks; this cannot be undone)". Leave it unticked to remove only the program and keep your conversations and files.

## Known issues

- Kilo has usage limits, and Kilo AI decides the quota and availability. When you run out, wait a while or switch to another model.
- If you only use Kilo you cannot subscribe to news yet: news needs web search, so add a DeepSeek API key or a search tool under Capabilities.
- If the current model does not support image input, a message with an image cannot be sent; it reminds you to switch to a model that can read images.
- The installer is not signed, so Windows stops it the first time.
- Tested only on Windows 10 and 11.

## Privacy

Sidemate has no accounts and no servers of its own, and collects no usage data. With the Kilo model, content is sent to Kilo AI for processing. See [PRIVACY.md](../PRIVACY.md).
