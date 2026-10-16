# Contributing to ARX

Thank you for helping. Issues and pull requests are both welcome.

## Issues

Open an issue for:

- a place where the specification is unclear, contradicts itself, or disagrees with a fixture;
- a fixture whose expected result looks wrong;
- two validators that give different results for the same input;
- a proposal for the next version (describe the use case first, then the change).

For a validator bug, include the manifest or package that shows it, the validator and its version, and what you expected.

## Pull requests

This repository is published from the maintainer's source tree. A pull request is not merged here directly: the maintainer applies the change to the source tree, publishes it back to this repository, and credits you as a co-author of that commit (`Co-authored-by`). Your pull request is then closed with a link to that commit.

Before opening a pull request:

- Run the tests of every validator you touched (see [README](README.md#run-the-tests)). A change to the specification, a schema or a fixture must keep all three validators passing.
- Change the Korean specification (normative) and its English translation together. `packages/arx-core/test/spec-translation.test.ts` checks that both have the same sections, tables, code blocks, RFC 2119 keywords and links.
- Change fixtures and sprites through their generators in `tools/` and commit what the generators write. Do not edit generated images, videos or packages by hand.
- Do not add images, video, audio, fonts or text that you did not make yourself or that is not under a compatible open license. Test data in this repository is synthetic (see [README](README.md#test-data)).

## License of contributions

By contributing you agree that your contribution is provided under the license of the files it changes: Apache-2.0 for code, schemas and fixtures (section 5 of the license), and CC BY 4.0 for the specification documents in `spec/`. You confirm that you have the right to contribute it.
