# TF2AutobotPlus

<div align="center">
  <a href="https://autobot.tf/">
    <img src="./src/assets/tf2autobotpluslogo.png" alt="TF2AutobotPlus" width="400">
  </a>
</div>

**Enhanced fork of TF2Autobot with kewweol's optimizations**  
*Now featuring automatic backpack.tf pricing integration and performance improvements*

[![Discord](https://img.shields.io/discord/664971400678998016?label=Discord&logo=discord)](https://discord.gg/4k5tmMkXjB)
![License](https://img.shields.io/github/license/idinium96/tf2autobot)
![Version](https://img.shields.io/badge/version-Plus-brightgreen)

## Key Improvements by kewweol

### NEW AUTOPRICER!!! *(experimental)*
- The pricer has been completely rewritten from `prices.tf` to the `bptf API`.
- The `prices.tf` autopricer has been removed and is no longer used.

**Attention! Sometimes the autopricer does not take into account some item attributes, so you need to check and adjust prices manually.**

### Attention! Experimental features are in the active testing phase and offer no guarantees.

## Features
- Automatic backpack.tf pricing integration
- Performance improvements
- Optimized code structure for better readability and maintainability
- Improved error handling and logging system
- Now you can hardcode Trade URL

## Requirements
- Steam account with Mobile Authenticator (SDA) 
- NodeJS 18.17+ (LTS recommended)  
- Typescript 4.1+  

## Get started
```bash
git clone https://github.com/kewweol/tf2autobotplus.git
cd tf2autobotplus
npm install
node run build
```
- Create a `.env` file, copy the text from `template.env`, and fill in the data.
- Run `node ./dist/app.js`