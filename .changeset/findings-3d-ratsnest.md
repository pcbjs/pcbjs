---
'@pcbjs/ui': patch
---

DRC and ERC findings are annotated in the 3D view: a ring at each DRC finding on its layer and a diamond on the pad or part an ERC finding names, coloured by severity, with the rule on a leader, the message on hover, following the explode. A finding whose evidence is a ratsnest line, such as `unconnected`, and a `route-failed` leg are drawn as that line in the severity colour with the rule at its middle, in 2D and 3D, instead of a marker. A click on a marker, line or label in either view focuses the finding and selects it, shift adding it.

The 3D ratsnest is a dashed line of constant screen width at every zoom, wider for a line that carries a finding and wider still when focused, with the 2D strokes in the same proportion. A line carrying an `unconnected` finding is labelled with a broken-connection icon and the net, as is that finding's row in the findings list. Ratsnest labels show while the DRC tab is open, else only on the line hovered or the one holding the focused or selected finding; markers keep their rule labels.

The ratsnest stroke is thinner and follows the zoom: 1.2 px at the default fit, between 0.8 and 2.5 px, a finding line 1.5 times and the focused line twice that, slightly translucent, with round-capped dashes three widths long and two apart, marching, in 2D and 3D. A hover or click between two dashes lands on the line through an unseen solid line of the same width, at least 6 px.
