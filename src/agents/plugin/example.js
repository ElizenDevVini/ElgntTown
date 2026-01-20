/**
 * Eliza Town - Example Plugin Template
 */

export const examplePlugin = {
  name: 'example',
  description: 'An example plugin template',
  
  actions: {
    doSomething: async (input) => {
      return Processed: ${input}
    },

    fetchData: async (url) => {
      // const response = await fetch(url)
      // return await response.json()
      return { example: 'data' }
    }
  },

  init: async () => {
    console.log('[ExamplePlugin] Initialized')
  },

  cleanup: async () => {
    console.log('[ExamplePlugin] Cleaned up')
  }
}

// Uncomment to add GitHub integration
// export const githubPlugin = {
//   name: 'github',
//   actions: {
//     createRepo: async (name, description) => { },
//     createPullRequest: async (repo, branch, title) => { }
//   }
// }

export default examplePlugin
