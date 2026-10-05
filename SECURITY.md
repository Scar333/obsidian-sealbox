# Reporting a vulnerability

Please do not open a public issue for a security problem.

Use GitHub's private vulnerability reporting instead: the **Security** tab of this
repository, then **Report a vulnerability**. It is private until a fix is
published, and it does not expose anyone's email address.

## What is in scope

Anything that lets someone read sealed content without the password, weakens the
key derivation, or writes plaintext somewhere it should not go — a file, a log, a
network request.

The threat model is deliberately narrow and documented in the README: Sealbox
protects a vault at rest. It does not defend against malware already running on
the machine, and reports along those lines will be closed with a pointer to that
section.

## What to expect

This is a one-person project, so a first reply may take a few days. If a fix is
needed I will ship it as a patch release and credit you in the release notes
unless you would rather stay anonymous.

Sealbox has not had an independent security audit. If you are looking at the
crypto, `README.md` specifies the container format byte for byte, and
`tools/sealbox-decrypt.mjs` is a second implementation of it that shares no code
with the plugin.
