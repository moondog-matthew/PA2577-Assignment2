const emptyLine = /^\s*$/;
const oneLineComment = /\/\/.*/;
const oneLineMultiLineComment = /\/\*.*?\*\//; 
const openMultiLineComment = /\/\*+[^\*\/]*$/;
const closeMultiLineComment = /^[\*\/]*\*+\//;

const SourceLine = require('./SourceLine');
const FileStorage = require('./FileStorage');
const Clone = require('./Clone');

const DEFAULT_CHUNKSIZE=5;

class CloneDetector {
    #myChunkSize = process.env.CHUNKSIZE || DEFAULT_CHUNKSIZE;
    #myFileStore = FileStorage.getInstance();

    constructor() {
    }

    // Private Methods
    // --------------------
    #filterLines(file) {
        let lines = file.contents.split('\n');
        let inMultiLineComment = false;
        file.lines=[];

        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];

            if ( inMultiLineComment ) {
                if ( -1 != line.search(closeMultiLineComment) ) {
                    line = line.replace(closeMultiLineComment, '');
                    inMultiLineComment = false;
                } else {
                    line = '';
                }
            }

            line = line.replace(emptyLine, '');
            line = line.replace(oneLineComment, '');
            line = line.replace(oneLineMultiLineComment, '');
            
            if ( -1 != line.search(openMultiLineComment) ) {
                line = line.replace(openMultiLineComment, '');
                inMultiLineComment = true;
            }

            file.lines.push( new SourceLine(i+1, line.trim()) );
        }
       
        return file;
    }

    #getContentLines(file) {
        return file.lines.filter( line => line.hasContent() );        
    }


    #chunkify(file) {
        let chunkSize = this.#myChunkSize;
        let lines = this.#getContentLines(file);
        file.chunks=[];

        for (let i = 0; i <= lines.length-chunkSize; i++) {
            let chunk = lines.slice(i, i+chunkSize);
            file.chunks.push(chunk);
        }
        return file;
    }
    
    #chunkMatch(first, second) {
        let match = true;

        if (first.length != second.length) { match = false; }
        for (let idx=0; idx < first.length; idx++) {
            if (!first[idx].equals(second[idx])) { match = false; }
        }

        return match;
    }

    #filterCloneCandidates(file, compareFile) {
        file.instances = file.instances || [];

        const newInstances = file.chunks.flatMap(chunk => 
            compareFile.chunks
                .filter(compareChunk => this.#chunkMatch(chunk, compareChunk))
                .map(matchedChunk => new Clone(file.name, compareFile.name, chunk, matchedChunk))
        );

        file.instances = file.instances.concat(newInstances);
        return file;
    }
         
    #expandCloneCandidates(file) {
        file.instances = file.instances.reduce((accumulator, currentClone) => {
            const existingExpandedClone = accumulator.find(clone => clone.maybeExpandWith(currentClone));
            
            if (!existingExpandedClone) {
                accumulator.push(currentClone);
            }
            
            return accumulator;
        }, []);

        return file;
    }
        
    #consolidateClones(file) {
        file.instances = file.instances.reduce((accumulator, currentClone) => {
            const existingClone = accumulator.find(clone => clone.equals(currentClone));
            
            if (existingClone) {
                existingClone.addTarget(currentClone);
            } else {
                accumulator.push(currentClone);
            }
            
            return accumulator;
        }, []);

        return file;
    }
    

    // Public Processing Steps
    // --------------------
    preprocess(file) {
        return new Promise( (resolve, reject) => {
            if (!file.name.endsWith('.java') ) {
                reject(file.name + ' is not a java file. Discarding.');
            } else if(this.#myFileStore.isFileProcessed(file.name)) {
                reject(file.name + ' has already been processed.');
            } else {
                resolve(file);
            }
        });
    }

    transform(file) {
        file = this.#filterLines(file);
        file = this.#chunkify(file);
        return file;
    }

    matchDetect(file) {
        let allFiles = this.#myFileStore.getAllFiles();
        file.instances = file.instances || [];
        for (let f of allFiles) {
            // TODO implement these methods (or re-write the function matchDetect() to your own liking)
            // 
            // Overall process:
            // 
            // 1. Find all equal chunks in file and f. Represent each matching pair as a Clone.
            //
            // 2. For each Clone with endLine=x, merge it with Clone with endLine-1=x
            //    remove the now redundant clone, rinse & repeat.
            //    note that you may end up with several "root" Clones for each processed file f
            //    if there are more than one clone between the file f and the current
            //
            // 3. If the same clone is found in several places, consolidate them into one Clone.
            //
            file = this.#filterCloneCandidates(file, f); 
            file = this.#expandCloneCandidates(file);
            file = this.#consolidateClones(file); 
        }

        return file;
    }

    pruneFile(file) {
        delete file.lines;
        delete file.instances;
        return file;
    }
    
    storeFile(file) {
        this.#myFileStore.storeFile(this.pruneFile(file));
        return file;
    }

    get numberOfProcessedFiles() { return this.#myFileStore.numberOfFiles; }
}

module.exports = CloneDetector;
