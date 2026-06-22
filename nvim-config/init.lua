-- Beginner VS Code-like Neovim config
-- Location: C:\Users\Admin\AppData\Local\nvim\init.lua

vim.g.mapleader = " "

-- Basic editor settings
vim.opt.number = true
vim.opt.relativenumber = true
vim.opt.mouse = "a"
vim.opt.clipboard = "unnamedplus"
vim.opt.expandtab = true
vim.opt.shiftwidth = 2
vim.opt.tabstop = 2
vim.opt.smartindent = true
vim.opt.wrap = false
vim.opt.ignorecase = true
vim.opt.smartcase = true
vim.opt.termguicolors = true
vim.opt.signcolumn = "yes"
vim.opt.updatetime = 250

-- Bootstrap lazy.nvim plugin manager
local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not vim.loop.fs_stat(lazypath) then
  vim.fn.system({
    "git", "clone", "--filter=blob:none",
    "https://github.com/folke/lazy.nvim.git",
    "--branch=stable",
    lazypath,
  })
end
vim.opt.rtp:prepend(lazypath)

require("lazy").setup({
  -- Nice colors
  { "folke/tokyonight.nvim", priority = 1000, config = function()
    vim.cmd.colorscheme("tokyonight-night")
  end },

  -- File explorer like VS Code sidebar
  { "nvim-tree/nvim-tree.lua", dependencies = { "nvim-tree/nvim-web-devicons" }, config = function()
    require("nvim-tree").setup({ view = { width = 32 } })
  end },

  -- Fuzzy finder: files, text search, buffers
  { "nvim-telescope/telescope.nvim", dependencies = { "nvim-lua/plenary.nvim" } },

  -- Bottom status bar
  { "nvim-lualine/lualine.nvim", dependencies = { "nvim-tree/nvim-web-devicons" }, config = function()
    require("lualine").setup()
  end },

  -- Git signs in the left column
  { "lewis6991/gitsigns.nvim", config = function()
    require("gitsigns").setup()
  end },

  -- Full Git diff viewer, like VS Code Source Control diff
  { "sindrets/diffview.nvim", dependencies = { "nvim-lua/plenary.nvim" } },

  -- Better syntax highlighting
  -- New nvim-treesitter versions work mostly by default on Neovim 0.12+.
  { "nvim-treesitter/nvim-treesitter", lazy = false, build = ":TSUpdate", config = function()
    require("nvim-treesitter").setup()
  end },

  -- Shows possible keybinds after pressing leader keys
  { "folke/which-key.nvim", config = function()
    require("which-key").setup()
  end },
})

-- Keymaps: press Space then key
local map = vim.keymap.set
map("n", "<leader>e", ":NvimTreeToggle<CR>", { desc = "Toggle file explorer" })
map("n", "<leader>ff", ":Telescope find_files<CR>", { desc = "Find files" })
map("n", "<leader>fg", ":Telescope live_grep<CR>", { desc = "Search text in project" })
map("n", "<leader>fb", ":Telescope buffers<CR>", { desc = "Open buffers" })
map("n", "<leader>w", ":w<CR>", { desc = "Save file" })
map("n", "<leader>q", ":q<CR>", { desc = "Quit" })

-- Git keymaps
map("n", "<leader>gd", ":Gitsigns preview_hunk<CR>", { desc = "Git: preview current change" })
map("n", "<leader>gj", ":Gitsigns next_hunk<CR>", { desc = "Git: next change" })
map("n", "<leader>gk", ":Gitsigns prev_hunk<CR>", { desc = "Git: previous change" })
map("n", "<leader>gs", ":Gitsigns stage_hunk<CR>", { desc = "Git: stage current change" })
map("n", "<leader>gr", ":Gitsigns reset_hunk<CR>", { desc = "Git: reset current change" })
map("n", "<leader>gb", ":Gitsigns blame_line<CR>", { desc = "Git: blame current line" })
map("n", "<leader>go", ":DiffviewOpen<CR>", { desc = "Git: open diff for working tree" })
map("n", "<leader>gm", ":DiffviewOpen master...HEAD<CR>", { desc = "Git: compare HEAD with master" })
map("n", "<leader>gM", ":DiffviewOpen main...HEAD<CR>", { desc = "Git: compare HEAD with main" })
map("n", "<leader>gc", ":DiffviewClose<CR>", { desc = "Git: close diff view" })

-- Window movement like an IDE split layout
map("n", "<C-h>", "<C-w>h", { desc = "Move to left window" })
map("n", "<C-j>", "<C-w>j", { desc = "Move to lower window" })
map("n", "<C-k>", "<C-w>k", { desc = "Move to upper window" })
map("n", "<C-l>", "<C-w>l", { desc = "Move to right window" })

-- Easier terminal inside Neovim
map("n", "<leader>t", ":split | terminal<CR>", { desc = "Open terminal" })
map("t", "<Esc>", "<C-\\><C-n>", { desc = "Exit terminal mode" })
