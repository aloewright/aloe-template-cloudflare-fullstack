---
sidebar_position: 1
slug: /
---

# Introduction

This template is a working reference for shipping a SaaS on Cloudflare Workers.
It's deliberately minimal — one Worker serves the React UI and the API, D1
backs the data, Polar handles billing, and a stubbed gate demonstrates the
protected-route pattern without requiring you to wire auth.

The live demo at [template.lazee.workers.dev](https://template.lazee.workers.dev)
is deployed from this exact code. Click "Enter demo" to see the protected
route without paying anything.
