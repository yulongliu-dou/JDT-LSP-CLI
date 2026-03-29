const { spawn } = require('child_process');
const path = require('path');

async function testCommand(args, description) {
    console.log(`\n=== 测试: ${description} ===`);
    console.log(`命令: node dist/cli.js ${args.join(' ')}`);
    
    return new Promise((resolve) => {
        const child = spawn('node', ['dist/cli.js', ...args], {
            cwd: path.resolve(__dirname)
        });
        
        let stdout = '';
        let stderr = '';
        
        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        child.on('close', (code) => {
            console.log(`退出码: ${code}`);
            if (stdout) console.log(`输出:\n${stdout}`);
            if (stderr) console.log(`错误:\n${stderr}`);
            resolve({ code, stdout, stderr });
        });
    });
}

async function main() {
    console.log('开始测试 jls --global 参数行为...\n');
    
    // 测试各种参数组合
    await testCommand(['--global', '--symbol', 'String'], '--global --symbol String');
    await testCommand(['--global', '--method', 'toString'], '--global --method toString');
    await testCommand(['--global', '--symbol', 'String', '--kind', 'class'], '--global --symbol String --kind class');
    await testCommand(['--global', '--method', 'toString', '--kind', 'method'], '--global --method toString --kind method');
    await testCommand(['--global'], '--global (单独使用)');
    
    console.log('\n测试完成');
}

main().catch(console.error);