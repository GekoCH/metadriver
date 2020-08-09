
'use strict';

const { imageHelper } = require("./imageHelper");
const { labelHelper } = require("./labelHelper");
const { switchHelper } = require("./switchHelper");
const { sensorHelper } = require("./sensorHelper");
const { sliderHelper } = require("./sliderHelper");
const { directoryHelper } = require("./directoryHelper");
const { exec } = require("child_process");
const { cachedDataVersionTag } = require('v8'); // check if needed for discovery of neeo brain and suppress otherwise.
const { resolve } = require("path");

const xpath = require('xpath');
const xmldom = require('xmldom').DOMParser;
const parserXMLString = require('xml2js').Parser({explicitArray:false, mergeAttrs : true});
const http = require('http.min');
const jpath = require('jsonpath');
const io = require('socket.io-client');
const wol = require('wake_on_lan');
const { isArray } = require("util");
const variablePattern = {'pre':'$','post':''};
const RESULT = variablePattern.pre + 'Result' + variablePattern.post;
const HTTPGET = 'http-get';
const HTTPGETSOAP = 'http-get-soap';
const HTTPPOST = 'http-post';
const STATIC = 'static';
const CLI = 'cli';
const WEBSOCKET = 'webSocket';

//STRATEGY DESIGN PATTERN FOR THE COMMAND TO BE USED (HTTPGET, post, websocket, ...) New processor to be added here. This strategy mix both transport and data format (json, soap, ...)
class ProcessingManager {
  constructor() {
    this._processor = null;
  }; 
  set processor(processor) {
    this._processor = processor;
  };
  get processor() {
    return this._processor;
  }
  process(command) {
    return new Promise( (resolve, reject) => {
      this._processor.process(command)
      .then((result) => {resolve(result)})
      .catch((err) => reject (err))
    })
  }
  query(data, query) {
    return this._processor.query(data, query)
  }
  startListen (command, listener, _listenCallback, socket) {
    return this._processor.startListen(command, listener, _listenCallback, socket)
  }
  stopListen (listener) {
    return this._processor.stopListen(listener)
  }

}
class httpgetProcessor {
  constructor() {
  }; 
  process (command) {
    return new Promise(function (resolve, reject) {
      http(command) 
      .then(function(result) { 
        resolve(result.data)
      })
      .catch((err) => {reject (err)})
    })
  }
  query (data, query) {
    return new Promise(function (resolve, reject) {
      if (query) {
        try {
          if (typeof(data) == 'string') {data = JSON.parse(data)}
          resolve(jpath.query(data, query));
        }
        catch (err) {
          console.log('error ' + err + ' in JSONPATH ' + query + ' processing of :' + data)
        }
      }
      else {resolve(data)}
    })
  }
  startListen (command, listener, _listenCallback) {
    return new Promise(function (resolve, reject) {
        let previousResult = '';
        listener.timer = setInterval(() => {
          http(command) 
          .then(function(result) { 
            if (result != previousResult) {
              previousResult = result;
              _listenCallback(result, listener);
            }
            resolve('')
          })
          .catch((err) => {console.log(err)})
        }, (listener.pooltime?listener.pooltime:1000));
        if (listener.poolduration && (listener.poolduration != '')) {
          setTimeout(() => {
            clearInterval(listener.timer)
          }, listener.poolduration);
        }
    })
  }
  stopListen (listener) {
    clearInterval(listener.timer);
  }
}

class webSocketProcessor {
  process (command, socket) {
    return new Promise(function (resolve, reject) {
      if (typeof(command) == 'string') {command = JSON.parse(command)}
      if (command.call){
        listener.io.emit(command.emit, command.message)
        resolve('')
      }
    })
  }
  query (data, query) {
    return new Promise(function (resolve, reject) {
      try {
        resolve(jpath.query(data, query));
      }
      catch (err) {
        console.log('error ' + err + ' in JSONPATH ' + query + ' processing of :' + data)
      }
    })
  }
  startListen (command, listener, _listenCallback) {
    return new Promise(function (resolve, reject) {
        console.log('Starting to listen to the device.')
        console.log(listener)
        console.log(command)
        listener.io = io.connect(listener.socket);
        listener.io.on(command, (result) => {_listenCallback(result, listener)});
        resolve('');
   })
  }
  stopListen (listener) {
    console.log('Stop listening to the device.')
    listener.io.disconnect(listener.socket);
  }
}

function convertXMLTable2JSON (TableXML, indent, TableJSON) {
  return new Promise(function (resolve, reject) {
      parserXMLString.parseStringPromise(TableXML[indent]).then((result) => {
      if (result) {
        TableJSON.push(result)
        indent = indent + 1;
        if (indent < TableXML.length) {
          resolve(convertXMLTable2JSON(TableXML,indent,TableJSON))
        }
        else 
        {
          resolve(TableJSON);
        }
        
      }
      else {
        console.log(err);
      }
    });
  })
}

class httpgetSoapProcessor {
  process (command) {
    return new Promise(function (resolve, reject) {
      http(command) 
      .then(function(result) { 
        resolve(result.data)
      })
      .catch((err) => {reject (err)})
    })
  }
  query (data, query) {
    return new Promise(function (resolve, reject) {
      if (query) {
        try {
          console.log('RAW XPATH Return elt 0: ' + data);
          var doc = new xmldom().parseFromString(data);
          console.log('RAW XPATH Return elt 0.1: ' + doc);
          console.log('RAW XPATH Return elt 0.1: ' + query);
          var nodes = xpath.select(query, doc);
          console.log('RAW XPATH Return elt : ' + nodes);
          console.log('RAW XPATH Return elt 2: ' + nodes.toString());
          let JSonResult = [];
          convertXMLTable2JSON(nodes, 0, JSonResult).then((result) => {
            console.log('Result of conversion +> ');
            console.log(result);
            resolve(result)
          })
        }
        catch (err) {
          console.log('error ' + err + ' in XPATH ' + query + ' processing of :' + data)
        }
      }
      else {resolve(data)}
    })
  }
  listen (command, listener, _listenCallback) {
    return '';
  }
}
class httppostProcessor {
  process (command) {
    return new Promise(function (resolve, reject) {
      if (typeof(command) == 'string') {command = JSON.parse(command)}
      if (command.call){
        http.post(command.call, command.message) 
        .then(function(result) { 
          resolve(result.data)
        })
        .catch((err) => {console.log(err);reject (err)})
      }
      else {reject('no post command provided or improper format')}
    })
  }
  query (data, query) {
    return new Promise(function (resolve, reject) {
      try {
        resolve(jpath.query(JSON.parse(data), query));
      }
      catch (err) {
        console.log('error ' + err + ' in JSONPATH ' + query + ' processing of :' + data)
      }
    })
  }
  listen (command, listener, _listenCallback) {
    return '';
  }
}
class staticProcessor {
  process (command) {
    return new Promise(function (resolve, reject) {
      resolve(command);
    })
  }
  query (data, query) {
    return new Promise(function (resolve, reject) {
        try {
        resolve(jpath.query(JSON.parse(data), query));
        }
        catch {
          console.log('error in JSONPATH ' + query + ' processing of :' + data)
        }
    })
  }
  listen (command, listener, _listenCallback) {
    return '';
  }
}
class cliProcessor {
  process (command) {
    return new Promise(function (resolve, reject) {
        exec(command, (stdout, stderr) => {
          if (stdout) {
            resolve(stdout);
          }
          else {
            resolve(stderr);
          }
        })
    })
  }
  query (data, query) {
    return new Promise(function (resolve, reject) {
      try {
        //let resultArray = new [];
        resolve(data.split(query));
      }
      catch {
        console.log('error in string.search regex :' + query + ' processing of :' + data)
      }
    })
  }
  listen (command, listener, _listenCallback) {
    return '';
  }
}


const processingManager = new ProcessingManager();
const myHttpgetProcessor = new httpgetProcessor();
const myHttpgetSoapProcessor = new httpgetSoapProcessor();
const myHttppostProcessor = new httppostProcessor();
const myCliProcessor = new cliProcessor();
const myStaticProcessor = new staticProcessor();
const myWebSocketProcessor = new webSocketProcessor();

module.exports = function controller(driver) {
  this.buttons = driver.buttons; //structure keeping all buttons of the driver
  this.sendComponentUpdate;
  this.socket;
  this.deviceVariables = []; //container for all device variables.
  this.listeners = []; //container for all device listeners.
  this.imageH = []; //image helper to store all the getter of the dynamically created images.
  this.sensorH = []; //sensor helper to store all the getter and setter of the dynamically created sensors.
  this.switchH = []; //sensor switch to store all the getter and setter of the dynamically created switches.
  this.labelH = []; //label helper to store all the getter and setter of the dynamically created labels.
  this.sliderH = []; //slider helper to store all the getter and setter of the dynamically created sliders.
  this.directoryH = []; //directory helper to store all the browse getter and setter of the dynamically created simple directories.
  var self = this;
   
 
  this.addListener = function(params) {
    params.timer = ""; // for pooling
    params.io = ""; // for websocket
    self.listeners.push(params);
  }

  this.addVariable = function(name, value) {
    self.deviceVariables.push({'name':name, 'value':value, 'listeners': []});
  }

  this.addListenerVariable = function(theVariable, theFunction) { // who listen to variable changes.
    if (theVariable != undefined && theVariable != '' && theFunction != undefined && theFunction) {
      const listenerList = self.deviceVariables.find(elt => {return elt.name == theVariable}).listeners;
      listenerList.push(theFunction);
      return listenerList[listenerList.length-1];
    }
    else {return undefined};
  }

  this.addImageHelper = function(imageName, listened) {//function called by the MetaDriver to store 
    const newImageH = new imageHelper(imageName, listened, self)
    self.imageH.push(newImageH);
    return newImageH;
  }
  
  this.addLabelHelper = function(labelName, listened) {//function called by the MetaDriver to store 
    const newLabelH = new labelHelper(labelName, listened, self)
    self.labelH.push(newLabelH);
    return newLabelH;
  }

  this.addSensorHelper = function(sensorName, listened) {//function called by the MetaDriver to store 
    const newSensorH = new sensorHelper(sensorName, listened, self)
    self.sensorH.push(newSensorH);
    return newSensorH;
  }

  this.addSwitchHelper = function(switchName, listen, evaldo) {//function called by the MetaDriver to store 
    const newSwitchH = new switchHelper(switchName, listen, evaldo, self)
    self.switchH.push(newSwitchH);
    return newSwitchH;
  }

  this.addSliderHelper = function(listen, evaldo, slidername) {//function called by the MetaDriver to store 
    const newSliderH = new sliderHelper(listen, evaldo, slidername, self)
    self.sliderH.push(newSliderH);
    return newSliderH;
  }

  this.addDirectoryHelper = function(dirname) {//function called by the MetaDriver to store the features of the list 
    const newDirectoryH = new directoryHelper(dirname, self)
    self.directoryH.push(newDirectoryH);
    return newDirectoryH;
  }

  this.registerStateUpdateCallback = function(updateFunction) {//technical function to send event to the remote.
    self.sendComponentUpdate = updateFunction;
  };

   this.registerInitiationCallback = function() {//technical function called at device initiation to start some listeners
 /*
    self.listeners.forEach(listener => {
      self.listenStart(listener)
    });
 */
  }
  

  this.writeVariable = function(theVariable, theValue, deviceId) {//deviceId necessary as push to components.
    let foundVar = self.deviceVariables.find(elt => {return elt.name == theVariable});
    if (foundVar.value != theValue) {// If the value changed.
      foundVar.value = theValue; //Write value here
      foundVar.listeners.forEach(element => { //invoke all listeners
        element(deviceId, foundVar.value);
      });
    }
  }

  this.assignTo = function(Pattern, inputChain, givenResult) //Assign a value to the input chain. Pattern found is replaced by given value
  {
   try {
      if (givenResult && !(typeof(givenResult) in {"string":"", "number":"", "boolean":""}) ) {//in case the response is a json object, convert to string
        givenResult = JSON.stringify(givenResult);
      }
      
      if (typeof(inputChain) == 'string') {
        if (inputChain.startsWith('DYNAMIK ')) {
          if (givenResult && (typeof(givenResult) == 'string' )) {
            givenResult = givenResult.replace(/\\/g, '\\\\') // Absolutely necessary to properly escape the escaped character. Or super tricky bug.
            givenResult = givenResult.replace(/"/g, '\\"') // Absolutely necessary to properly escape the escaped character. Or super tricky bug.
          }
          inputChain = inputChain.replace(Pattern, givenResult);
          console.log(inputChain.split('DYNAMIK ')[1])
          console.log(eval(inputChain.split('DYNAMIK ')[1]))
          return eval(inputChain.split('DYNAMIK ')[1]);
        }
        else {
          inputChain = inputChain.replace(Pattern, givenResult);
          return inputChain;
        }
      }
      return inputChain;
    }
    catch (err) {
      console.log('function assignedTo error with argument ('+Pattern+', '+inputChain+', '+givenResult+'). Error: ' + err)
    }
  }


  this.readVariables = function(inputChain) { //replace in the input chain, all the variables found.
    let preparedResult = inputChain;
    if (typeof(preparedResult) == 'object') {
      preparedResult = JSON.stringify(preparedResult);
    }
    if (typeof(preparedResult) == 'string')
      self.deviceVariables.forEach(variable => {
        let token = variablePattern.pre + variable.name + variablePattern.post;
        while (preparedResult != preparedResult.replace(token, variable.value)) {
          preparedResult = preparedResult.replace(token, variable.value);
        }
    })
     return preparedResult;
  }

  
  this.commandProcessor = function(command, commandtype) { // process any command according to the target protocole
    return new Promise(function (resolve, reject) {
      if (commandtype == HTTPGET) {
        processingManager.processor = myHttpgetProcessor;
      } 
      else if (commandtype == HTTPGETSOAP) {
        processingManager.processor = myHttpgetSoapProcessor;
      } 
      else if (commandtype == HTTPPOST) {
        processingManager.processor = myHttppostProcessor;
      }
      else if (commandtype == STATIC) {
        processingManager.processor = myStaticProcessor;
      }
      else if (commandtype == CLI) {
        processingManager.processor = myCliProcessor;
      }
      else if (commandtype == WEBSOCKET) {
        processingManager.processor = myWebSocketProcessor;
      }
      else {reject('The commandtype to process is not defined.' + commandtype + ' command : ' + command)}
      command = self.readVariables(command);
      command = self.assignTo(RESULT, command, "");
      console.log('final command : ')
      console.log(command)
      processingManager.process(command, self.socket)
        .then((result) => {
          resolve(result)
        })
        .catch((err) => {reject (err)})
    })    
  }

  this.listenProcessor = function(command, commandtype, listener) { // process any command according to the target protocole
    return new Promise(function (resolve, reject) {
      if (commandtype == HTTPGET) {
        processingManager.processor = myHttpgetProcessor;
      } 
      else if (commandtype == HTTPGETSOAP) {
        processingManager.processor = myHttpgetSoapProcessor;
      } 
      else if (commandtype == HTTPPOST) {
        processingManager.processor = myHttppostProcessor;
      }
      else if (commandtype == STATIC) {
        processingManager.processor = myStaticProcessor;
      }
      else if (commandtype == CLI) {
        processingManager.processor = myCliProcessor;
      }
      else if (commandtype == WEBSOCKET) {
        processingManager.processor = myWebSocketProcessor;
      }
      else {reject('The commandtype to listen is not defined.' + commandtype + ' command : ' + command)}
      command = self.readVariables(command);
      processingManager.startListen(command, listener, self.onListenExecute)
        .then((result) => {
           resolve(result)
        })
        .catch((err) => {reject (err)})
    })    
  }

  this.stopListenProcessor = function(command, commandtype, listener) { // process any command according to the target protocole
    return new Promise(function (resolve, reject) {
      console.log('command')
      console.log(command)
      console.log(commandtype)
      if (commandtype == HTTPGET) {
        processingManager.processor = myHttpgetProcessor;
      } 
      else if (commandtype == HTTPGETSOAP) {
        processingManager.processor = myHttpgetSoapProcessor;
      } 
      else if (commandtype == HTTPPOST) {
        processingManager.processor = myHttppostProcessor;
      }
      else if (commandtype == STATIC) {
        processingManager.processor = myStaticProcessor;
      }
      else if (commandtype == CLI) {
        processingManager.processor = myCliProcessor;
      }
      else if (commandtype == WEBSOCKET) {
        processingManager.processor = myWebSocketProcessor;
      }
      else {reject('The commandtype to stop listen is not defined.' + commandtype + ' command : ' + command)}
       processingManager.stopListen(listener);
    })    
  }

  this.queryProcessor = function (data, query, commandtype) { // process any command according to the target protocole
    return new Promise(function (resolve, reject) {
      if (commandtype == HTTPGET) {
        processingManager.processor = myHttpgetProcessor;
      }
      else if (commandtype == HTTPGETSOAP) {
        processingManager.processor = myHttpgetSoapProcessor;
      } 
      else if (commandtype == HTTPPOST) {
        processingManager.processor = myHttppostProcessor;
      }
      else if (commandtype == STATIC) {
        processingManager.processor = myStaticProcessor;
      }
      else if (commandtype == CLI) {
        processingManager.processor = myCliProcessor;
      }
      else if (commandtype == WEBSOCKET) {
        processingManager.processor = myWebSocketProcessor;
      }
      else {reject('commandtype to querry is not defined.')}
      //console.log('Query Processor : ' + query)
      query = self.readVariables(query);
      //console.log('Query Processor : ' + query)
      if (query != undefined && query != '') {
        processingManager.query(data, query).then((data) => {
          console.log("Result of the query")
          console.log(data)
          resolve(data)
        })
      }
      else {resolve(data)}
    })
  }
/*
  this.displayStatus = function (deviceId, message) {

    self.sendComponentUpdate({uniqueDeviceId: deviceId, component: 'Status',value: message})
    .catch( (err) => {console.log ("Message was " + message + " - Error generated is : " + err)})
    setTimeout(() => {
      self.sendComponentUpdate({uniqueDeviceId: deviceId, component: 'Status',value: 'Ready'})
      .catch( (err) => {console.log ("Message was " + message + " - Error generated is : " + err)})
    }, 3000);

  }
*/
  
  this.evalWrite = function (evalwrite, result, deviceId) {
    if (evalwrite) { //case we want to write inside a variable
      evalwrite.forEach(evalW => {
        //process the value
        let finalValue = self.readVariables(evalW.value);
        finalValue = self.assignTo(RESULT, finalValue, result);
        console.log('assigning to ' + evalW.variable + ' result before writing variables : ' + finalValue)
        self.writeVariable(evalW.variable, finalValue, deviceId); 
      });
    }
  }

    this.evalDo = function (evaldo, result, deviceId) {
    if (evaldo) { //case we want to trigger a button
      evaldo.forEach(evalD => {
        if (evalD.test == '' || evalD.test == true) {evalD.test = true}; //in case of no test, go to the do function
        let finalDoTest = self.readVariables(evalD.test);// prepare the test to assign variable and be evaluated.
        finalDoTest = self.assignTo(RESULT, finalDoTest, result);
        if (finalDoTest) {
          if (evalD.then && evalD.then != '')
          {
           self.onButtonPressed(evalD.then, deviceId);
          }
        }
        else { 
          if (evalD.or && evalD.or != '')
          {
            self.onButtonPressed(evalD.or, deviceId)
          }
        }
       })
    }
  }

  this.onListenExecute = function (result, listener) {
    let deviceId = 'default' // TODO Find a way to dynamically get the deviceId (in order to support discovery)    
    self.queryProcessor(result, listener.queryresult, listener.type).then((result) => {
      //result = result[0];
      if (Array.isArray(result)) {
        result = result[0];
      }
      if (listener.evalwrite) {self.evalWrite(listener.evalwrite, result, deviceId);}
      //if (listener.evaldo) {self.evalDo(listener.evaldo, result, deviceId);}
    })
  }

  this.listenStart = function (listener) {
    return new Promise(function (resolve, reject) {
      try {
        console.log('Listener starting'); 
        console.log(listener)
        self.listenProcessor(listener.command, listener.type, listener);
      } 
      catch (err) {reject('Error when starting to listen. ' + err)}
    })
  }
  this.listenStop = function (listener) {
    return new Promise(function (resolve, reject) {
      try {
        console.log('Listener stopping.'); 
        console.log(listener)
        self.stopListenProcessor(listener.command, listener.type, listener);
      } 
      catch (err) {reject('Error when starting to listen. ' + err)}
    })
  }


  this.actionManager = function (name, deviceId, commandtype, command, queryresult, evaldo, evalwrite) {
    return new Promise(function (resolve, reject) {
      try {
        console.log(command+ ' - ' + commandtype)
        self.commandProcessor(command, commandtype)
        .then((result) => {
          self.queryProcessor(result, queryresult, commandtype).then((result) => {
            if (Array.isArray(result)) {
              result = result[0];
            }
            if (evalwrite) {self.evalWrite(evalwrite, result, deviceId);}
            if (evaldo) {self.evalDo(evaldo, result, deviceId);}
            resolve(result);
          })
        })
        .catch((result) => { //if the command doesn't work.
          result = 'Command failed:' + result;
          if (evalwrite) {self.evalWrite(evalwrite, result, deviceId);}
          if (evaldo) {self.evalDo(evaldo, result, deviceId);}
          resolve('Error during the post command processing' + result)
        }) 
      }
      catch {reject('Error while processing the command.')}
    })
  }
  
  this.onButtonPressed = function(name, deviceId) {
    console.log('[CONTROLLER]' + name + ' button pressed for device ' + deviceId);
 
    let theButton = self.buttons[name];
    if (name == "INITIALISE") {//Listener management to listen to other devices. Start listening on power on.
      self.listeners.forEach(listener => {
        self.listenStart(listener);
      });
    }
    if (name == "CLEANUP") {//listener management to listen to other devices. Stop listening on power off.
      self.listeners.forEach(listener => {
        self.listenStop(listener);
      });
    }
    if (theButton != undefined) {
      if ((theButton.type == HTTPGET) || (theButton.type == HTTPPOST) || (theButton.type == STATIC) || (theButton.type == WEBSOCKET) || (theButton.type == CLI)) {
        if (theButton.command != undefined){ 
          self.actionManager(name, deviceId, theButton.type, theButton.command, theButton.queryresult, theButton.evaldo, theButton.evalwrite)
          .then((result)=>{
            console.log('Processed: '+result)
          })
          .catch((err) => { 
              console.log("Error when processing the command : " + err)
           })
        }
      }
      else if (theButton.type == 'wol') {
        console.log(theButton.command)
        wol.wake(theButton.command, function(error) {
          if (error) {
            console.log(error)
          } else {
            console.log('Success')
            // done sending packets
          }
        });
        var magic_packet = wol.createMagicPacket(theButton.command);
      }
    }
  }
}

