# Sidemate

Sidemate is a small helper on the Windows desktop: drop files on it, say what you need, and it hands you a document.

It sits at the top edge of the screen and shows nothing but a pair of eyes. There are no accounts and no server, and it collects no usage data. Your keys are stored encrypted on this computer.

## What it does

- **Works with several models**: Kilo (no key needed), DeepSeek, GLM (Zhipu), or your own OpenAI-style or Anthropic-style API.
- **Writing and flowcharts**: "Writing" is built in, and the recommended "Flowcharts" skill draws boxes and arrows you can edit in Word or PowerPoint.
- **Skills and services**: import a skill folder or .zip, or ask for one in a conversation (it shows a confirmation card and downloads only after you click); connect outside services over MCP.
- **Scheduled news**: say what you want to read and when; at that time your model searches and reads the original pages itself, and every item links to a page it actually opened.
- **Task window**: add a message while it works; each result is a card you can open, save elsewhere or drag to the desktop; type again to keep refining.

See the release notes in [docs](docs) for what changed in each version.

## Installing

1. Download the latest `sidemate-setup-<version>.exe` from [Releases](https://github.com/deskware-team/sidemate/releases) and run it. The installer is not signed, so when Windows warns you, click "More info" and then "Run anyway".
2. On first launch, pick a model: paste a DeepSeek key and click "Test", choose GLM or Kilo, or set up your own. Once the test passes you are ready.

Get a DeepSeek key from the [DeepSeek platform](https://platform.deepseek.com/).

Upgrading from 0.2 to 0.3: 0.3 does not read 0.2's key or records, so paste your key again; 0.2's files are still in `C:\Users\<your user name>\桌伴`.

## Privacy

Sidemate has no accounts and no server, and it collects no usage data. Your keys are encrypted on this computer. Task content goes only to the model you chose; with Kilo, content is processed by Kilo AI outside China. See [PRIVACY.md](PRIVACY.md) for details.

## License

The code in this repository is under the MIT license; see [LICENSE](LICENSE). The third-party components shipped with it and their licenses are listed in [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt).

## Security

Please report security problems by email to hello@deskware.cn instead of opening a public issue. See [SECURITY.md](SECURITY.md).
