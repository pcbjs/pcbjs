# Test font

`RobotoSlab-subset.ttf` is Roboto Slab v2.002, Copyright 2018 The Roboto Slab Project Authors, https://github.com/googlefonts/robotoslab, under the Apache License 2.0 in `LICENSE-Apache-2.0.txt`, as the font's name table states in IDs 13 and 14.

It was cut from `RobotoSlab-VariableFont_wght.ttf`, sha256 3de05586cfcd95ab31a5fca77bff545a51a34a629ba7bc9b23c21e98b3aa4c26, the owner's installed copy, with fontTools 4.61.1: `pyftsubset RobotoSlab-VariableFont_wght.ttf --unicodes="U+0020-007E,U+00A9,U+00B0,U+00B5,U+00B7" --layout-features=kern --name-IDs="*"`. The subset keeps ASCII, the copyright sign, degree, micro and middle dot, the weight axis, the kerning and every name record, the licence among them; nothing else was changed.
