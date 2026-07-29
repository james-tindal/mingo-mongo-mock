import { defineConfig } from 'tsdown'

export default defineConfig({
  fixedExtension: false,
  unbundle: true,
  sourcemap: true,
  outputOptions: {
    sourcemapExcludeSources: true,
  },
})
