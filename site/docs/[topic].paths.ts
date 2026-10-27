import { readTopic, topicNames } from '../.vitepress/topics'

export default {
  watch: ['../../docs/*.md'],
  paths() {
    return topicNames().map(topic => {
      const { title, description, body } = readTopic(topic)
      return { params: { topic, title, description }, content: `::: v-pre\n${body}\n:::\n` }
    })
  },
}
