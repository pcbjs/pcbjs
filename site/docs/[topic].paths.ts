import { readTopic, topicNames, vueSafe } from '../.vitepress/topics'
import { developmentTopics } from '../scripts/development.mjs'

export default {
  watch: ['../../docs/*.md'],
  paths() {
    return topicNames().map(topic => {
      const { title, description, body } = readTopic(topic)
      const moved = developmentTopics.get(topic)
      if (moved)
        return {
          params: { topic, title, description },
          content: `---\nlayout: false\nsearch: false\n---\n\n<DocRedirect to="${moved.link}" />\n\n# ${title}\n\nThis specification now lives in [${moved.title}](${moved.link}). Existing section links follow the move.\n`,
        }
      return { params: { topic, title, description }, content: vueSafe(body) }
    })
  },
}
