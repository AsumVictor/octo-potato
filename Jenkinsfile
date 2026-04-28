pipeline {
  agent any

  tools {
    nodejs 'NodeJS-20'
  }

  stages {
    stage('Install') {
      steps {
        sh 'npm ci'
      }
    }

    stage('Test') {
      steps {
        sh 'npm run test:ci'
      }
    }
  }

  post {
    always {
      junit 'junit.xml'

      publishHTML(target: [
        allowMissing:         true,
        alwaysLinkToLastBuild: true,
        keepAll:              true,
        reportDir:            'coverage/lcov-report',
        reportFiles:          'index.html',
        reportName:           'Coverage Report'
      ])
    }
    failure {
      echo 'Tests failed — check the Test Results tab above.'
    }
  }
}
