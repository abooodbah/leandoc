# Code signing with SignPath Foundation

## Status: signing is off

LeanDoc applied to [SignPath Foundation](https://signpath.org/) for free code
signing. The application was declined in October 2026, so signing is off.

- The Windows ZIP on GitHub Releases is unsigned. Windows SmartScreen may show
  a warning for it.
- The Microsoft Store build is signed by Microsoft when the Store publishes it.

The signing steps and the artifact configuration described below are kept,
but they do nothing: the steps run only when the repository variable
`SIGNPATH_ORGANIZATION_ID` is set, and it is not set. Every build, including a
release build, packages the unsigned files. The rest of this page describes
how the setup would work if a later application were accepted.

## What the repository has

- The README, the download page ([site/index.html](../site/index.html)), and
  the release notes template ([docs/releases/TEMPLATE.md](releases/TEMPLATE.md))
  state the privacy policy and say how to uninstall. They no longer carry a
  "Code signing policy" section or a SignPath credit, and
  `node scripts/Test-ReleaseEngineering.mjs` and `node site/validate.mjs` fail
  if the credit comes back. A later application would need that section
  added back first.
- Version resources on both programs that get signed: `LeanDoc.exe`
  (`src/windows/LeanDoc.rc`) and `tools\leandoc-inspect.exe`
  (`tools/inspect/leandoc-inspect.rc`). Each has ProductName `LeanDoc` and
  ProductVersion equal to the `package.json` version. `tests/Test-LeanDoc.ps1`
  checks the built files.
- The SignPath artifact configuration in
  [.signpath/artifact-configuration.xml](../.signpath/artifact-configuration.xml).
  It signs `LeanDoc.exe` and `tools/leandoc-inspect.exe` with Authenticode and
  checks that each names the product LeanDoc and the release version.
  `WebView2Loader.dll` is Microsoft's file and is never sent.
- Signing steps in the Windows job of
  [.github/workflows/build.yml](../.github/workflows/build.yml). On a `v*`
  tag, and only when the repository variable `SIGNPATH_ORGANIZATION_ID` is
  set, the job uploads the two programs as an artifact, submits it to
  SignPath, waits up to 30 minutes for the signed files, checks their
  signatures and versions, puts them into the payload, and builds the ZIP with
  `scripts/package-release.ps1 -Signed`, which writes in `INSTALL.txt` that
  the programs are signed. The ZIP's `.sha256` file and the winget hash are
  taken from that signed ZIP as before.

## Steps for the owner, if a later application is accepted

1. Turn on two-factor authentication for the GitHub account `abooodbah`
   (GitHub > Settings > Password and authentication). SignPath Foundation
   requires it for everyone who can commit or approve.
2. Apply at <https://signpath.org/apply> with the repository
   <https://github.com/abooodbah/leandoc>, the MIT license, and the download
   page <https://abooodbah.github.io/leandoc/>, after adding the code signing
   policy section back to the README, the site, and the release notes
   template.
3. When SignPath accepts the project, sign in to SignPath and create:
   - a project with the slug `leandoc`, linked to the GitHub repository
     `abooodbah/leandoc` as its trusted build system (GitHub.com);
   - a signing policy with the slug `release-signing` that uses the SignPath
     Foundation certificate and requires manual approval, with `abooodbah` as
     the approver;
   - the project's artifact configuration: paste the whole of
     `.signpath/artifact-configuration.xml` and make it the default. If you
     change the file in the repository later, paste it again.
4. In SignPath, create an API token for a user (or CI user) that may submit
   signing requests to the project, and copy the organization ID.
5. In GitHub, open the repository's Settings > Secrets and variables >
   Actions and add:
   - the variable `SIGNPATH_ORGANIZATION_ID` with the organization ID;
   - the secret `SIGNPATH_API_TOKEN` with the API token.
6. Release as described in [CONTRIBUTING.md](../CONTRIBUTING.md). Write the
   release notes from `docs/releases/TEMPLATE.md`, and change its sentence to
   say the Windows programs are signed.

## Each release after that

The Windows job stops at "Sign the executables with SignPath" and waits.
Approve the signing request in SignPath within 30 minutes; SignPath sends the
approval request by email and shows it in the web app. If nobody approves in
time, the step fails, no release is published, and the run can be started
again from the Actions tab. A rejected request fails the release the same
way.

After the release, check one program on a Windows machine:

```powershell
Get-AuthenticodeSignature .\LeanDoc.exe | Format-List Status, SignerCertificate
```

The status should be `Valid` and the signer SignPath Foundation.

## Turning signing off

Delete the repository variable `SIGNPATH_ORGANIZATION_ID`. The next release
packages the unsigned files again; nothing else needs to change.
