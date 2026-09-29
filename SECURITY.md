# Security

## Reporting a problem

Please report security problems privately, through GitHub's private vulnerability reporting:

**<https://github.com/aboufama/amble/security/advisories/new>**

This is the same link as **Report a security problem privately** on Amble's privacy page (`#/privacy`). Please don't open a public issue for a security problem. If the form isn't available, open an issue that only asks for a private way to reach us, and leave the details out.

A good report says what an attacker could do, and gives the steps to show it, with a made-up world or file if one is needed.

## Please leave student data out

Don't put student data in a report: no names or initials, no worlds, drawings, recordings or `.amble` files made by students, and no class links or class codes from a real class. Make your own example instead. If you came across student data while finding the problem, say what kind it was, not what it said.

## What is in scope

- **The app**: this repository's code and the copy of Amble built from it, including the in-app pages, the service worker, and how Amble talks to an AI address (the class code, a key typed into Settings, and what a request carries).
- **The sandbox**: the game player (the sandboxed frame, its content security policy, the runtime and the kit), and anything that lets game code reach the network, Amble's storage, the page around it, or another world.
- **Its files**: reading `.amble` files, class links, and web pages made with Share as a web page.

Out of scope: a district's own AI service or proxy, GitHub Pages itself, browser bugs, and problems that need someone to already control the Chromebook or its browser profile.
