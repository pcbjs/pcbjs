import { agentsPage, changelogPage } from './.vitepress/topics'

export default {
  watch: ['../README.md', '../CHANGELOG.md', '../packages/pcbjs/CHANGELOG.md'],
  paths: () => [
    {
      params: {
        page: 'agents',
        title: 'For agents',
        description: 'How a coding agent works with pcbjs: the mental model, the commands, reading pcbjs check, and where files land.',
      },
      content: `::: v-pre\n${agentsPage()}\n:::\n`,
    },
    { params: { page: 'changelog', title: 'Changelog', description: 'Release notes of the pcbjs packages.' }, content: `::: v-pre\n${changelogPage()}\n:::\n` },
  ],
}
