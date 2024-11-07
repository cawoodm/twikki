# TWikki
TWikki is an extensible wiki and information platform inspired by TiddlyWiki.  

## Background
TiddlyWiki started as a simple note-taking browser app famous for storing all code and data in a single file. In an age in which thumb-drives were hip it was a cool idea to just take your entire knowlege with you in a simple .html file without needing any application (other than a browser) to view and interact with it. In the meantime TiddlyWiki developed into an advanced platform for application development with advanced features for storing data outside the .html file. The downsides are that saving your data with TiddlyWiki are idiosyncratic at best, require some technical knowledge at worst although there are cloud hosted solutions which ease the process.

TWikki is designed to just work out of the box - the fact is .html files have no access to your local file system and thus saving properly used to be a pain. TiddlyWiki got around this by actually re-writing the .html file each time you saved and offering it to you as a download. Thus you had to keep re-downloading the document you were editing each time you saved it. I know.

With Twikki it automatically saves every change you make to localStorage. If you use TWikki every day you can do this pretty much indefinitely. Unfortunately browsers tend to clear localStorage after some time of unuse (e.g. 7 days in Chrome on iOS) and thus you do need a more permanent solution.

We still offer the download a backup option available in TiddlyWiki but provide a simple way to save your data to a provider of your choice. Examples are jsonbin.org, github.com, dropbox and Google drive.

## Overview
What is special about twikki is that it's cloud-native - your data is stored in the cloud (wherever you choose) and synched to your browser which means it works offline. Whether you visit a web page hosting twikki or eve just open a small .html file in your browser you can synch up your data and get started.