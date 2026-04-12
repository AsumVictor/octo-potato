pipeline {
  agent any

  tools {
    // Requires "NodeJS-20" configured in Jenkins → Manage Jenkins → Tools
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
      // Publish JUnit XML so Jenkins shows per-test pass/fail
      junit 'junit.xml'

      // Publish HTML coverage report (requires HTML Publisher plugin)
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
