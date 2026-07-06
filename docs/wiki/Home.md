# Camera Lab Wiki

This wiki is the long-form documentation for Camera Lab. The repository `README.md`
is intentionally short; use these pages when you need setup details, architecture,
workflow mappings, or development notes.

## Pages

- [Installation Guide](Installation-Guide.md) - beginner-friendly setup, Docker choices, model folders, and troubleshooting.
- [Architecture](Architecture.md) - system architecture, data flow, and workspace diagrams.
- [Workspaces](Workspaces.md) - what Camera Lab, Director, Edit, Motion, and Casting do.
- [Models and Workflows](Models-and-Workflows.md) - model folders, workflow files, and frontend workflow mappings.
- [Director Reference](Director-Reference.md) - Director v2 notes and legacy reference behavior.
- [Developer Guide](Developer-Guide.md) - repo layout, tests, runtime data, and local development commands.

## Syncing To GitHub Wiki

GitHub Wiki is a separate Git repository. After enabling Wiki in the GitHub
repository settings, clone it next to this repo:

```bash
git clone git@github.com:ai2764/Camera-lab.wiki.git ../Camera-lab.wiki
```

Then copy these files into the wiki checkout:

```bash
cp docs/wiki/*.md ../Camera-lab.wiki/
cd ../Camera-lab.wiki
git add .
git commit -m "Add Camera Lab wiki documentation"
git push
```

