---
title: Getting started
description: Build and understand Blinky, from setup to checked PCB.
---

# Getting started

Build **Blinky**, a small board with three LED channels switched by a transistor. Follow one setup path, then work through the same design from electrical connections to physical copper.

## Choose your setup

| Path | Use it when |
| --- | --- |
| [Setup with npm](./npm-setup) | You want to create the project and run its commands yourself. |
| [Setup with an agent](./agentic-setup) | You want a coding agent to create and edit the project, with checks you can inspect. |

Add [VS Code extension setup](./extension-setup) for synchronized editor previews, or try the smaller [Quickstart](./quickstart) first.

Both paths create the same project. You can switch between manual edits and agent assistance at any point.

## Build Blinky, one step at a time

| Step | What you will learn | What you will see |
| --- | --- | --- |
| [Build the schematic](./schematic) | Define nets and parts, then arrange their symbols. | The connector, transistor and LED channels connected electrically. |
| [Define the board](./board) | Set the outline, dimensions and basic rules. | A 30 × 20 mm board with rounded corners. |
| [Place the parts](./placement) | Place individual parts and repeated channel layouts. | Parts positioned on the front and back of the board. |
| [Route the board](./routing) | Combine manual, automatic and hybrid routing. | Copper implementing the connections in the schematic. |
| [Check DRC and ERC](./checks) | Read findings, make corrections and verify the result. | A checked design ready for the next review. |

Each lesson shows complete source files beside the board or schematic compiled from those files. Only the relevant lines are highlighted. Earlier layout steps omit parts and routes that have not been added yet. Hover the source to find the corresponding object; use the view tabs to compare 2D, schematic and 3D.

## After the walkthrough

Choose an [Advanced topic](../advanced/) when you need reusable groups, more precise placement, controlled routing or manufacturing output. Use the [Reference](/docs/basics) to look up exact attributes and commands.
