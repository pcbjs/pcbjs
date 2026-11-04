const lesson = (text: string, path: string) => ({ text, link: `/guide/${path}` })

export const guideSidebar = [
  {
    text: 'Getting started',
    collapsed: false,
    items: [
      lesson('Overview', 'getting-started/'),
      lesson('Quickstart', 'getting-started/quickstart'),
      lesson('Setup with npm', 'getting-started/npm-setup'),
      lesson('Setup with an agent', 'getting-started/agentic-setup'),
      lesson('Set up VS Code', 'getting-started/extension-setup'),
      lesson('Build the schematic', 'getting-started/schematic'),
      lesson('Define the board', 'getting-started/board'),
      lesson('Place the parts', 'getting-started/placement'),
      lesson('Route the board', 'getting-started/routing'),
      lesson('Check DRC and ERC', 'getting-started/checks'),
    ],
  },
  {
    text: 'Advanced',
    collapsed: false,
    items: [
      lesson('Choose a topic', 'advanced/'),
      {
        text: 'Reusable design',
        collapsed: true,
        items: [
          lesson('Reusable blocks', 'advanced/composition/reusable-blocks'),
          lesson('Instance and library layouts', 'advanced/composition/instance-layouts'),
          lesson('Reference labels', 'advanced/composition/reference-labels'),
        ],
      },
      {
        text: 'Precision placement',
        collapsed: true,
        items: [lesson('Placement grids', 'advanced/precision/placement-grids'), lesson('Transforms and rotation', 'advanced/precision/transforms')],
      },
      {
        text: 'Routing and copper',
        collapsed: true,
        items: [
          lesson('Route constraints', 'advanced/routing/route-constraints'),
          lesson('Differential pairs', 'advanced/routing/differential-pairs'),
          lesson('Length matching', 'advanced/routing/length-matching'),
          lesson('Copper pours', 'advanced/routing/copper-pours'),
        ],
      },
      {
        text: 'Inspection and delivery',
        collapsed: true,
        items: [lesson('Part models', 'advanced/delivery/part-models'), lesson('Manufacturing output', 'advanced/delivery/manufacturing')],
      },
    ],
  },
]
