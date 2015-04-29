require('console.table')
var _ = require('lodash')
var pg = require('pg')
var babar = require('babar')
var stats = require('simple-statistics')
var spawn = require('child_process').spawn

var scoresLoadFixture = require('../fixtures/scoresLoad')

var clear = function() {
  process.stdout.write('\u001B[2J\u001B[0;0f')
}

// For querySequence compatibility with main test suite
process.env.CONN = options.conn

if(typeof options.assign_count === 'number') {
  // Allow override from command line
  settings.init.assignPerClass = options.assign_count
}

var memoryUsage  = []
var classUpdates = []
var waitingOps   = []
var eventTimes   = []

var selectCount = settings.maxSelects &&
  settings.maxSelects < settings.init.classCount ?
    settings.maxSelects : settings.init.classCount

// Create initial data
var fixtureData = scoresLoadFixture.generate(
  settings.init.classCount,
  settings.init.assignPerClass,
  settings.init.studentsPerClass,
  settings.init.classesPerStudent
)

console.log(
  'Press CTRL+C to exit and display results when satisfied with duration.\n\n',
  settings, '\n\n',
  'Initial Data Count \n',
  'Students: ', fixtureData.students.length,
  'Assignments: ', fixtureData.assignments.length,
  'Scores: ', fixtureData.scores.length, '\n'
)

var clientDone = null
var clientPromise = new Promise((resolve, reject) => {
  console.time('Connected to database server')
  pg.connect(options.conn, (error, client, done) => {
    console.timeEnd('Connected to database server')
    if(error) return reject(error)
    clientDone = done
    resolve(client)
  })
}).catch(reason => console.error(reason))

var installPromise = new Promise((resolve, reject) => {
  clientPromise.then(client => {
    console.time('Installed inital data')
    scoresLoadFixture.install(fixtureData).then(() => {
      console.timeEnd('Installed inital data')
      resolve()
    }, reject)
  }, reject)
}).catch(reason => console.error(reason))

// Spawn child process
var childPromise = new Promise((resolve, reject) => {
  installPromise.then(() => {
    var child = spawn('node', [
      '--debug',
      'test/load/runner/',
      JSON.stringify(options),
      JSON.stringify(settings)
    ])

    // Unit tests do not instantiate LiveSelect instances
    if(!('maxSelects' in settings)) {
      resolve(child)
    }else{
      console.time('Initialized each select instance')
    }

    child.stdout.on('data', data => {
      data = data.toString().split(' ')
      switch(data[0]) {
        case 'MEMORY_USAGE':
          memoryUsage.push({
            time: parseInt(data[1], 10),
            memory: parseInt(data[2], 10),
            memoryUsed: parseInt(data[3], 10)
          })
          break
        case 'NEXT_EVENT':
          // Unit tests will give times
          eventTimes.push(parseInt(data[1], 10))
          break
        case 'CLASS_UPDATE':
          // Default "end-to-end" load test mode will log score updates
          var eventTime = parseInt(data[1], 10)
          var classId = parseInt(data[2], 10)
          var scoreIds = data[3].split(',').map(scoreDetails =>
            scoreDetails.split('@').map(num => parseInt(num, 10)))
          var responseTimes = null

          if(waitingOps.length !== 0){
            var myOps = waitingOps.filter(op =>
              scoreIds.filter(score =>
                score[0] === op.scoreId && score[1] >= op.score).length !== 0)
            // Remove myOps from the global wait list
            waitingOps = waitingOps.filter(op => myOps.indexOf(op) === -1)

            // Calculate response time
            responseTimes = myOps.map(op => eventTime - op.time)
          }

          classUpdates.push({
            time: eventTime,
            responseTimes
          })

          if(classUpdates.length === selectCount) {
            // childPromise is ready when all selects have initial data
            console.timeEnd('Initialized each select instance')
            // Wait for LivePG interval to come around, just in case...
            setTimeout(() => resolve(child), 200)
          }
          break
        default:
          console.log('stdout', data)
          break
      }
    })

    child.stderr.on('data', data => {
      console.log('stderr', data.toString())
    })

    child.on('close', code => {
      console.log('exited with code', code)
    })
  }, reject)
}).catch(reason => console.error(reason))

// Begin throttled test operations
var performRandom = {
  update() {
    // Select random score record
    do {
      var scoreRow = fixtureData.scores[
        Math.floor(Math.random() * fixtureData.scores.length)]

      var classId = fixtureData.assignments[scoreRow.assignment_id - 1].class_id
    } while(classId > settings.maxSelects)

    clientPromise.then(client => {
      scoreRow.score++

      // Record operation time
      waitingOps.push({
        scoreId: scoreRow.id,
        classId,
        score: scoreRow.score,
        time: Date.now()
      })

      client.query(
        'UPDATE scores SET score = score + 1 WHERE id = $1', [ scoreRow.id ])
    })
  },
  insert() {
    // Select random assignment and student ids
    do {
      var assignId =
        Math.floor(Math.random() * fixtureData.assignments.length) + 1
      var classId = fixtureData.assignments[assignId - 1].class_id
    } while(classId > settings.maxSelects)

    var studentId = Math.floor(Math.random() * fixtureData.students.length) + 1

    var scoreId = fixtureData.scores.length + 1

    clientPromise.then(client => {
      waitingOps.push({
        scoreId,
        classId,
        score: 5,
        time: Date.now()
      })

      fixtureData.scores.push({
        id: scoreId,
        assignment_id: assignId,
        student_id: studentId,
        score: 5
      })

      client.query(
        `INSERT INTO scores (id, assignment_id, student_id, score)
          VALUES ($1, $2, $3, $4)`, [ scoreId, assignId, studentId, 5 ])
    })
  }
}

var opRates = {}

childPromise.then(() => {
  console.log('\nLoad operations in progress...')

  // Redraw graphs every second
  setInterval(() => {
    clear()
    drawOutput()
  }, 1000)

  var startTime = Date.now()

  var getInterval = valueFun => valueFun((Date.now() - startTime) / 1000)

  if(settings.opPerSecond) {
    _.forOwn(performRandom, (fun, key) => {
      var value = settings.opPerSecond[key]
      if(!value) return

      switch(typeof value) {
        case 'number':
          // Static value provided
          opRates[key] = value
          setInterval(fun, Math.ceil(1000 / value))
          break
        case 'function':
          // Determined based on elapsed time
          // Single argument receives (float) number of seconds elapsed
          var nextOp = () => {
            fun()
            opRates[key] = getInterval(value)
            setTimeout(nextOp, Math.ceil(1000 / opRates[key]))
          }
          nextOp()
          break
      }
    })
  }
})

function drawOutput() {
  console.log('Op Per Second:',
    'insert', opRates.insert, 'update', opRates.update)

  var filteredEvents = classUpdates.filter(evt =>
    evt.responseTimes !== null && evt.responseTimes.length !== 0)

  var responseCount = filteredEvents.reduce(
    (count, evt) => count + evt.responseTimes.length, 0)

  if(memoryUsage.length !== 0){
    // Print memory usage graphs
    var firstMemTime = memoryUsage[0].time
    var memoryPrep = memoryUsage.map(record => [
      (record.time - firstMemTime) / 1000,
      Math.round(record.memory / Math.pow(1024, 2) * 10 ) / 10
    ])

    console.log(babar(memoryPrep, {
      caption: 'Memory Usage (Heap Total) by Elapsed Time (Megabytes / Seconds)'
    }))

    var memory2Prep = memoryUsage.map(record => [
      (record.time - firstMemTime) / 1000,
      Math.round(record.memoryUsed / Math.pow(1024, 2) * 10 ) / 10
    ])

    console.log(babar(memory2Prep, {
      caption: 'Memory Usage (Heap Used) by Elapsed Time (Megabytes / Seconds)'
    }))
  }

  if(filteredEvents.length !== 0) {
    // Print response time graph
    var eventPrep = filteredEvents.map(evt => [
      (evt.time - firstMemTime) / 1000,
      evt.responseTimes.reduce((prev, cur) => prev + cur, 0)
        / evt.responseTimes.length
    ])

    console.log(babar(eventPrep, {
      caption: 'Response Time by Elapsed Time (Milliseconds / Seconds)'
    }))
  }
}

process.on('SIGINT', () => {
  clientDone && clientDone()

  process.exit()
})

