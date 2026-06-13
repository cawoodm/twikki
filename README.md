# TWikki

[![E2E Tests](https://github.com/cawoodm/twikki/actions/workflows/e2e-tests.yml/badge.svg?branch=main)](https://github.com/cawoodm/twikki/actions/workflows/e2e-tests.yml?query=branch%3Amain)

TWikki is an extensible wiki and information platform inspired by TiddlyWiki.  

Demo: https://cawoodm.github.io/twikki/

See [docs/USP.md](docs/USP.md) for why TWikki improves on TiddlyWiki (for both everyday and technical users), and the [CHANGELOG](CHANGELOG.md) for what's new.

## What can it do?
TWikki is designed to run offline with cloud synch built-in. All libraries are cached in localStorage and updates are automatic.

## Background
TiddlyWiki started as a simple note-taking browser app famous for storing all code and data in a single file. In an age in which thumb-drives were hip it was a cool idea to just take your entire knowlege with you in a simple .html file without needing any application (other than a browser) to view and interact with it. In the meantime TiddlyWiki developed into an advanced platform for application development with advanced features for storing data outside the .html file. The downsides are that saving your data with TiddlyWiki are idiosyncratic at best, require some technical knowledge at worst although there are cloud hosted solutions which ease the process.

TWikki is designed to just work out of the box - the fact is .html files have no access to your local file system and thus saving properly used to be a pain. TiddlyWiki got around this by actually re-writing the .html file each time you saved and offering it to you as a download. Thus you had to keep re-downloading the document you were editing each time you saved it. I know.

With Twikki it automatically saves every change you make to localStorage. If you use TWikki every day you can do this pretty much indefinitely. Unfortunately browsers tend to clear localStorage after some time of unuse (e.g. 7 days in Chrome on iOS) and thus you do need a more permanent solution.

We offer a backup/synch option available in TiddlyWiki which saves your data to private gists on github.com.

## Overview
What is special about twikki is that it's cloud-native - your data is stored in the cloud (wherever you choose) and synched to your browser which means it works offline. Whether you visit a web page hosting twikki or eve just open a small .html file in your browser you can synch up your data and get started.

## Themes
TWikki's appearance is driven by data, not a build step - a theme is just a tiddler that lists the stylesheets to apply, so themes switch and edit live with no reload. See [docs/THEMES.md](docs/THEMES.md) for a visual showcase of the built-in themes and a guide to creating your own (including web fonts).