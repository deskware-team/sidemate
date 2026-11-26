# Sidemate

This project is developed on DeepSeek Harness. Sidemate is a small helper on the Windows desktop: drop files on it, say what you need, and it hands you a document.

It sits at the top edge of the screen and shows nothing but a pair of eyes. There are no accounts and no server, and it collects no usage data.

## What it does

- **Multiple model providers**:
  - **DeepSeek**: paste your own API key and pay for what you use; DeepSeek's native tools are supported.
  - **Kilo**: uses Kilo's gateway, with usage limits; see the Kilo notice in the app and Kilo's official terms.
  - **Custom**: enter an address, a model name and an API key; OpenAI-style and Anthropic-style APIs both work.
- **Writing and flowcharts**: "Writing" is built in, and the recommended "Flowcharts" skill draws boxes and arrows you can edit in Word or PowerPoint.
- **Install Skills, connect MCP**: import a skill folder or .zip, or ask for one in a conversation (it shows a confirmation card and downloads only after you click); connect outside services over MCP.
- **Scheduled news**: for each topic, say what you want to read and when, and subscribe to several topics; at that time your model searches and reads the original pages itself, and every item links to a page it actually opened.
- **Task window**: add a message while it works; each result is a card you can open, save elsewhere or drag to the desktop; type again to keep refining.
- **Preview**: read Word, PowerPoint, PDF, Excel, image and web files inside Sidemate, with zoom and "Save as".
- **Visuals in the conversation**: charts, flowcharts, formulas and images show up right in the reply; right-click a chart to save it.

See the release notes in [docs](docs) for what changed in each version.

## Installing

1. Download the latest `sidemate-setup-<version>.exe` from [Releases](https://github.com/deskware-team/sidemate/releases) and run it. The installer is not signed, so when Windows warns you, click "More info" and then "Run anyway".
2. On first launch, pick a model: paste a DeepSeek API key and click "Test", or set up another model yourself. Once the test passes you are ready.

Get a DeepSeek API key from the [DeepSeek platform](https://platform.deepseek.com/).

Upgrading from 0.3 to 0.4: just install the new version; your API key, conversations, news and settings carry over.

Upgrading from 0.2 to 0.3: 0.3 does not read 0.2's API key or records, so paste your API key again; 0.2's files are still in `C:\Users\<your user name>\桌伴`.

## Privacy

Sidemate has no accounts and no server, and it collects no usage data. With the Kilo model, content is sent to Kilo AI for processing. See [PRIVACY.md](PRIVACY.md) for details.

## Licence and trademarks

Sidemate's own source code in this repository is released under the MIT License; see [LICENSE](LICENSE). That licence does not apply to third-party components. Sidemate is developed on DeepSeek Harness (copyright DeepSeek, MIT License); DeepSeek Harness and the other third-party components shipped with Sidemate are distributed under their own licences, listed in [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt).

The names DeepSeek, DeepSeek Harness, Kilo and related marks belong to their respective owners. Sidemate is an independently developed, unofficial project with no affiliation, cooperation, authorisation or endorsement from those owners; this document mentions those names only to identify the open-source components Sidemate uses or the third-party services it is compatible with.

## Security

Please report security problems by email to hello@deskware.cn instead of opening a public issue. See [SECURITY.md](SECURITY.md).
