# My Neovim config

Beginner VS Code-like Neovim config for Windows.

## Install on a new Windows PC

Install Neovim and Git:

```powershell
winget install Neovim.Neovim
winget install Git.Git
```

Clone this repo into Neovim's config folder:

```powershell
git clone https://github.com/YOUR_USERNAME/nvim-config.git $env:LOCALAPPDATA\nvim
```

Then open Neovim:

```powershell
nvim
```

Plugins install automatically through `lazy.nvim`.

## Main keybinds

Leader key is `Space`.

```text
Space e   file explorer
Space ff  find files
Space fg  search text in project
Space fb  open buffers
Space w   save
Space q   quit
Space t   open terminal
```

Git:

```text
Space gd  preview current change
Space gj  next git change
Space gk  previous git change
Space gs  stage current change
Space gr  reset current change
Space gb  blame current line
Space go  open working-tree diff
Space gm  compare master...HEAD
Space gM  compare main...HEAD
Space gc  close diff view
```
