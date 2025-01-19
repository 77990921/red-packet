const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fetch = require('node-fetch');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.static(__dirname));

// 配置文件上传
const upload = multer({ dest: 'uploads/' });

// ComfyUI服务器地址
const COMFY_API = 'http://127.0.0.1:6006';

// 工作流配置映射
const workflowConfig = {
    'shanzi_gif_api.json': {
        inputNode: '21',    // LoadImage节点
        outputNode: '94',   // SaveImage节点
        outputType: 'images'
    },
    'snake_anime_api.json': {
        inputNode: '21',    // LoadImage节点
        outputNode: '94',   // SaveImage节点
        outputType: 'images'
    },
    'snake_photo_api.json': {
        inputNode: '27',    // LoadImage节点
        outputNode: '120',   // SaveImage节点
        outputType: 'images'
    },
    'food_anime_api.json': {
        inputNode: '21',    // LoadImage节点
        outputNode: '94',   // SaveImage节点
        outputType: 'images'
    },
    'food_photo_api.json': {
        inputNode: '27',
        outputNode: '120',
        outputType: 'images'
    },
    'fan_photo_api.json': {
        inputNode: '27',
        outputNode: '120',
        outputType: 'images'
    }
};

// 等待工作流执行完成的函数
async function waitForResult(promptId, config) {
    let retryCount = 0;
    const maxRetries = 300; // 5分钟

    while (retryCount < maxRetries) {
        try {
            const historyResponse = await fetch(`${COMFY_API}/history/${promptId}`);
            const history = await historyResponse.json();
            
            if (history[promptId] && history[promptId].outputs) {
                const outputs = history[promptId].outputs;
                const outputNode = config.outputNode;
                
                if (outputs[outputNode]) {
                    const output = outputs[outputNode];
                    if (output[config.outputType] && output[config.outputType].length > 0) {
                        const file = output[config.outputType][0];
                        console.log(`找到输出文件:`, file);
                        return {
                            output_url: `${COMFY_API}/view?filename=${encodeURIComponent(file.filename)}&type=output&subfolder=${encodeURIComponent(file.subfolder || '')}`
                        };
                    }
                }
            }
            
            if (history[promptId] && history[promptId].error) {
                throw new Error(`工作流执行错误: ${history[promptId].error}`);
            }
            
            console.log(`等待工作流执行... (${retryCount + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, 1000));
            retryCount++;
        } catch (error) {
            console.error('检查结果时出错:', error);
            await new Promise(resolve => setTimeout(resolve, 1000));
            retryCount++;
        }
    }
    
    throw new Error('等待超时：工作流执行时间过长');
}

// 生成随机种子
function generateRandomSeed() {
    return Math.floor(Math.random() * 1000000000000000);
}

// 更新KSampler节点的种子
function updateSamplerSeeds(workflow) {
    for (const nodeId in workflow) {
        const node = workflow[nodeId];
        if (node.class_type === 'KSampler' && node.inputs && 'seed' in node.inputs) {
            node.inputs.seed = generateRandomSeed();
        }
    }
    return workflow;
}

app.post('/api/generate', upload.single('image'), async (req, res) => {
    try {
        // 获取工作流名称
        const workflowName = req.body.workflow || 'shanzi_gif_api.json';
        
        // 获取工作流配置
        const config = workflowConfig[workflowName];
        if (!config) {
            throw new Error(`未找到工作流 ${workflowName} 的配置`);
        }

        // 验证工作流文件是否存在
        const workflowPath = path.join(__dirname, workflowName);
        if (!fs.existsSync(workflowPath)) {
            throw new Error(`工作流文件 ${workflowName} 不存在`);
        }

        // 加载工作流配置
        const workflow = JSON.parse(fs.readFileSync(workflowPath, 'utf8'));
        console.log(`加载工作流: ${workflowName}`);

        // 1. 上传图片到ComfyUI
        const formData = new FormData();
        formData.append('image', fs.createReadStream(req.file.path));
        
        const uploadResponse = await fetch(`${COMFY_API}/upload/image`, {
            method: 'POST',
            body: formData
        });

        const uploadResult = await uploadResponse.json();
        console.log('图片上传成功:', uploadResult);
        
        // 创建工作流副本并更新种子
        const workflowCopy = updateSamplerSeeds(JSON.parse(JSON.stringify(workflow)));
        const inputNode = workflowCopy[config.inputNode];

        // 更新图片输入
        if (!inputNode || !inputNode.inputs || !inputNode.inputs.image) {
            throw new Error('工作流中未找到正确的图片输入节点');
        }
        inputNode.inputs.image = uploadResult.name;
        
        console.log(`更新节点 ${config.inputNode} 的图片输入和随机种子`);
        
        // 3. 发送到ComfyUI
        const promptResponse = await fetch(`${COMFY_API}/prompt`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                prompt: workflowCopy
            })
        });

        const promptResult = await promptResponse.json();
        console.log('工作流开始执行:', promptResult);

        if (promptResult.error) {
            throw new Error(promptResult.error.message || '工作流执行失败');
        }

        // 4. 等待执行完成并获取结果
        const result = await waitForResult(promptResult.prompt_id, config);
        console.log('工作流执行完成，输出URL:', result.output_url);
        
        // 5. 清理上传的临时文件
        fs.unlink(req.file.path, (err) => {
            if (err) console.error('清理临时文件失败:', err);
        });

        res.json(result);

    } catch (error) {
        console.error('处理失败:', error);
        if (req.file) {
            fs.unlink(req.file.path, (err) => {
                if (err) console.error('清理临时文件失败:', err);
            });
        }
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/download', async (req, res) => {
    try {
        const fileUrl = req.query.url;
        if (!fileUrl) {
            throw new Error('未提供文件URL');
        }

        console.log('开始下载文件:', fileUrl);

        // 从ComfyUI获取文件
        const response = await fetch(fileUrl);
        if (!response.ok) {
            throw new Error('文件获取失败');
        }

        // 获取文件内容和类型
        const contentType = response.headers.get('content-type') || 'application/octet-stream';
        const buffer = await response.buffer();

        // 根据URL判断文件类型和名称
        const isGif = fileUrl.toLowerCase().includes('gif') || contentType.includes('gif');
        const filename = `专属拜年图像${isGif ? '.gif' : '.png'}`;

        // 设置响应头
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
        
        console.log('准备发送文件:', filename, contentType);
        
        // 发送文件
        res.send(buffer);

    } catch (error) {
        console.error('下载失败:', error);
        res.status(500).json({ error: error.message });
    }
});

app.listen(3003, () => {
    console.log('服务器运行在 http://localhost:3003');
}); 