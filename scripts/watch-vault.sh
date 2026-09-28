#!/bin/bash
# 监听 vault 文件变化并触发增量索引
VAULT_PATH="/Users/ljpsfree/Library/Mobile Documents/iCloud~md~obsidian/Documents/我的知识库"
KG_PATH=/Users/ljpsfree/dev/knowledge-graph
DATA_PATH=/Users/ljpsfree/.local/share/knowledge-graph

export KG_VAULT_PATH="$VAULT_PATH"
export KG_DATA_DIR="$DATA_PATH"

# 排除机器生成的数据：smart-connections 向量库、Syncthing 元数据、索引库自身
# 不排除的话，这些目录的写入会不停触发索引，索引又触发下一轮
/opt/homebrew/bin/fswatch -o \
  -e "\.git" -e "\.DS_Store" -e "kg\.db" \
  -e "\.smart-env" -e "\.stfolder" -e "\.stversions" -e "\.syncthing\..*\.tmp" \
  "$VAULT_PATH" | while read -r count; do
  /Users/ljpsfree/.nvm/versions/node/v24.5.0/bin/node "$KG_PATH/dist/cli/index.js" index >> /tmp/kg-index.log 2>&1
done
