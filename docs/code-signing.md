# Code signing with SignPath Foundation

LeanDoc applies for free code signing from SignPath Foundation. This page
lists what the repository already does and the steps only the owner can take.
Until those steps are done, every build, including a release build, packages
the unsigned files exactly as before.

## What the repository already has

- A section titled "Code signing policy" in [README.md](../README.md), on the
  download page ([site/index.html](../site/index.html)), and in the release
  notes template ([docs/releases/TEMPLATE.md](releases/TEMPLATE.md)). It
  credits SignPath, names the team roles, states the privacy policy, and says
  how to uninstall. `node scripts/Test-ReleaseEngineering.mjs` and
  `node site/validate.mjs` fail if any of it goes missing, and the release
  engineering check requires the section in the notes of every release after
  0.1.2.
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

## Steps for the owner

1. Turn on two-factor authentication for the GitHub account `abooodbah`
   (GitHub > Settings > Password and authentication). SignPath Foundation
   requires it for everyone who can commit or approve.
2. Apply at <https://signpath.org/apply> with the repository
   <https://github.com/abooodbah/leandoc>, the MIT license, and the download
   page <https://abooodbah.github.io/leandoc/>. The policy sections above are
   already live once this change is on `main` and the site has deployed.
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
   release notes from `docs/releases/TEMPLATE.md`, with the sentence that says
   the Windows programs are signed.

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
