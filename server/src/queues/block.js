'use strict'

const logger = require('../helpers/logger')
const BlockHelper = require('../helpers/block')
const config = require('config')
const emitter = require('../helpers/errorHandler')

const consumer = {}
consumer.name = 'BlockProcess'
consumer.processNumber = 1
consumer.task = async function (job, done) {
    let blockNumber = parseInt(job.data.block)
    try {
        logger.info('Process block: %s at %s', blockNumber, new Date())
        let b = await BlockHelper.crawlBlock(blockNumber)
        const q = require('./index')

        if (b) {
            let { txs, timestamp } = b
            let map = txs.map(tx => {
                return new Promise((resolve, reject) => {
                    q.create('TransactionProcess', { hash: tx.toLowerCase(), timestamp: timestamp })
                        .priority('high').removeOnComplete(true)
                        .attempts(5).backoff({ delay: 2000, type: 'fixed' }).save().on('complete', () => {
                            return resolve()
                        }).on('error', (e) => {
                            return reject(e)
                        })
                })
            })
            await Promise.all(map).catch(e => {
                throw e
            })
        }

        // Get signers for 100 blocks per time
        let blockStep = 100
        // Begin from epoch 2
        if ((blockNumber > config.get('BLOCK_PER_EPOCH') * 2) && (blockNumber % blockStep === 0)) {
            let endBlock = blockNumber - config.get('BLOCK_PER_EPOCH')
            let startBlock = endBlock - blockStep + 1
            q.create('BlockSignerProcess', { startBlock: startBlock, endBlock: endBlock })
                .priority('normal').removeOnComplete(true)
                .attempts(5).backoff({ delay: 2000, type: 'fixed' }).save()
            q.create('updateSpecialAccount', {})
                .priority('normal').removeOnComplete(true)
                .attempts(5).backoff({ delay: 2000, type: 'fixed' }).save()
        }
        if (blockNumber % 20 === 0) {
            q.create('BlockFinalityProcess', {})
                .priority('normal').removeOnComplete(true)
                .attempts(5).backoff({ delay: 2000, type: 'fixed' }).save()
        }

        done()
    } catch (e) {
        let sleep = (time) => new Promise((resolve) => setTimeout(resolve, time))
        await sleep(2000)
        done(e)
        return emitter.emit('errorCrawlBlock', e, blockNumber)
    }
}

module.exports = consumer
