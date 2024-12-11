const express = require('express');
const formidable = require('formidable');
const fs = require('fs/promises');
const app = express();
const PORT = 3000;

const Timer = require('./Timer');
const CloneDetector = require('./CloneDetector');
const CloneStorage = require('./CloneStorage');
const FileStorage = require('./FileStorage');

// Express and Formidable stuff to receive a file for further processing
// --------------------
const form = formidable({multiples:false});

app.post('/', fileReceiver );
function fileReceiver(req, res, next) {
    form.parse(req, (err, fields, files) => {
        fs.readFile(files.data.filepath, { encoding: 'utf8' })
            .then( data => { return processFile(fields.name, data); });
    });
    return res.end('');
}

app.get('/', viewClones );

const server = app.listen(PORT, () => { console.log('Listening for files on port', PORT); });

// Enhanced Timing Storage
// --------------------
class TimingStorage {
    static #myInstance = null;
    static getInstance() {
        TimingStorage.#myInstance = TimingStorage.#myInstance || new TimingStorage();
        return TimingStorage.#myInstance;
    }

    #myTimings = [];

    storeFileTiming(filename, contents, timers) {
        const timing = {
            filename,
            lineCount: contents.split('\n').length,
            timers: Object.entries(timers).reduce((acc, [timerName, duration]) => {
                // Explicitly convert BigInt to Number and divide
                acc[timerName] = Number(duration) / 1000;
                return acc;
            }, {}),
            normalizedTimings: {}
        };

        // Normalize timings by lines of code
        Object.entries(timing.timers).forEach(([timerName, duration]) => {
            timing.normalizedTimings[timerName] = 
                duration / timing.lineCount;
        });

        this.#myTimings.push(timing);
        return timing;
    }

    get timings() { return this.#myTimings; }

    getAggregateStatistics() {
        if (this.#myTimings.length === 0) return null;

        const aggregateStats = {
            totalFiles: this.#myTimings.length,
            averageTimings: {},
            normalizedAverageTimings: {}
        };

        // Get timer names dynamically from first entry
        const timerNames = Object.keys(this.#myTimings[0].timers);

        timerNames.forEach(timerName => {
            // Calculate average raw timings
            const totalTimings = this.#myTimings.reduce((sum, timing) => 
                sum + timing.timers[timerName], 0);
            aggregateStats.averageTimings[timerName] = 
                totalTimings / this.#myTimings.length;

            // Calculate average normalized timings
            const totalNormalizedTimings = this.#myTimings.reduce((sum, timing) => 
                sum + timing.normalizedTimings[timerName], 0);
            aggregateStats.normalizedAverageTimings[timerName] = 
                totalNormalizedTimings / this.#myTimings.length;
        });

        return aggregateStats;
    }
}

// Global timing storage
const timingStorage = TimingStorage.getInstance();

// Page generation for viewing current progress
// --------------------
function getStatistics() {
    let cloneStore = CloneStorage.getInstance();
    let fileStore = FileStorage.getInstance();
    let output = 'Processed ' + fileStore.numberOfFiles + ' files containing ' + cloneStore.numberOfClones + ' clones.'
    return output;
}

function listTimingsHTML() {
    let output = '<HR>\n<H2>File Processing Timings</H2>\n';
    let aggregateStats = timingStorage.getAggregateStatistics();

    // Aggregate Statistics
    if (aggregateStats) {
        output += '<H3>Aggregate Statistics</H3>\n';
        output += '<table border="1">\n';
        output += '<tr><th>Metric</th><th>Average Raw Time (µs)</th><th>Average Normalized Time (µs/line)</th></tr>\n';
        
        Object.keys(aggregateStats.averageTimings).forEach(timerName => {
            output += `<tr>
                <td>${timerName}</td>
                <td>${aggregateStats.averageTimings[timerName].toFixed(2)}</td>
                <td>${aggregateStats.normalizedAverageTimings[timerName].toFixed(4)}</td>
            </tr>\n`;
        });
        output += '</table>\n';
    }

    // Individual File Timings
    output += '<H3>Individual File Timings</H3>\n';
    output += '<table border="1">\n';
    output += '<tr><th>Filename</th><th>Lines</th>';
    
    // Dynamically create headers from first timing entry
    const timings = timingStorage.timings;
    if (timings.length > 0) {
        const timerNames = Object.keys(timings[0].timers);
        timerNames.forEach(timerName => {
            output += `<th>${timerName} (µs)</th>`;
            output += `<th>${timerName} (µs/line)</th>`;
        });
    }
    
    output += '</tr>\n';

    timings.forEach(timing => {
        output += '<tr>';
        output += `<td>${timing.filename}</td>`;
        output += `<td>${timing.lineCount}</td>`;
        
        Object.keys(timing.timers).forEach(timerName => {
            output += `<td>${timing.timers[timerName]}</td>`;
            output += `<td>${timing.normalizedTimings[timerName].toFixed(4)}</td>`;
        });
        
        output += '</tr>\n';
    });
    
    output += '</table>\n';

    return output;
}

function listClonesHTML() {
    let cloneStore = CloneStorage.getInstance();
    let output = '';

    cloneStore.clones.forEach( clone => {
        output += '<hr>\n';
        output += '<h2>Source File: ' + clone.sourceName + '</h2>\n';
        output += '<p>Starting at line: ' + clone.sourceStart + ' , ending at line: ' + clone.sourceEnd + '</p>\n';
        output += '<ul>';
        clone.targets.forEach( target => {
            output += '<li>Found in ' + target.name + ' starting at line ' + target.startLine + '\n';            
        });
        output += '</ul>\n'
        output += '<h3>Contents:</h3>\n<pre><code>\n';
        output += clone.originalCode;
        output += '</code></pre>\n';
    });

    return output;
}

function listProcessedFilesHTML() {
    let fs = FileStorage.getInstance();
    let output = '<HR>\n<H2>Processed Files</H2>\n'
    output += fs.filenames.reduce( (out, name) => {
        out += '<li>' + name + '\n';
        return out;
    }, '<ul>\n');
    output += '</ul>\n';
    return output;
}

function viewClones(req, res, next) {
    let page='<HTML><HEAD><TITLE>CodeStream Clone Detector</TITLE></HEAD>\n';
    page += '<BODY><H1>CodeStream Clone Detector</H1>\n';
    page += '<P>' + getStatistics() + '</P>\n';
    page += listTimingsHTML() + '\n';
    page += listClonesHTML() + '\n';
    page += listProcessedFilesHTML() + '\n';
    page += '</BODY></HTML>';
    res.send(page);
}

// Some helper functions
// --------------------
PASS = fn => d => {
    try {
        fn(d);
        return d;
    } catch (e) {
        throw e;
    }
};

const STATS_FREQ = 100;
const URL = process.env.URL || 'http://localhost:8080/';
var lastFile = null;

function maybePrintStatistics(file, cloneDetector, cloneStore) {
    if (0 == cloneDetector.numberOfProcessedFiles % STATS_FREQ) {
        console.log('Processed', cloneDetector.numberOfProcessedFiles, 'files and found', cloneStore.numberOfClones, 'clones.');
        let timers = Timer.getTimers(file);
        let str = 'Timers for last file processed: ';
        for (t in timers) {
            str += t + ': ' + (timers[t] / (1000n)) + ' µs '
        }
        console.log(str);
        console.log('List of found clones available at', URL);
    }

    return file;
}

// Processing of the file
// --------------------
function processFile(filename, contents) {
    let cd = new CloneDetector();
    let cloneStore = CloneStorage.getInstance();

    return Promise.resolve({name: filename, contents: contents} )
        .then( (file) => Timer.startTimer(file, 'total') )
        .then( (file) => cd.preprocess(file) )
        .then( (file) => cd.transform(file) )

        .then( (file) => Timer.startTimer(file, 'match') )
        .then( (file) => cd.matchDetect(file) )
        .then( (file) => cloneStore.storeClones(file) )
        .then( (file) => Timer.endTimer(file, 'match') )

        .then( (file) => cd.storeFile(file) )
        .then( (file) => Timer.endTimer(file, 'total') )
        .then( PASS( (file) => {
            // Store timing information
            const timers = Timer.getTimers(file);
            timingStorage.storeFileTiming(file.name, file.contents, timers);
            lastFile = file;
        }))
        .then( PASS( (file) => maybePrintStatistics(file, cd, cloneStore) ))
        .catch( console.log );
};
